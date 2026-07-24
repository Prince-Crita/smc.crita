/**
 * /api/admin/task-config/[clientId]
 *
 * GET  → Full task configuration for a specific client.
 *        Returns the default task types + any client-specific custom task
 *        types, with per-client overrides applied (rename / reorder /
 *        soft-delete) and subtask templates resolved
 *        (client-specific > global fallback).
 *
 * POST → Add a new custom MAIN task type for this client.
 *        Body: { title: string }
 *
 * PATCH → Modify main task types for this client.
 *        Body: { taskType, title }        → rename (defaults AND customs)
 *        Body: { order: string[] }        → reorder (array of taskType keys)
 *        Body: { taskType, restore:true } → restore a soft-deleted default
 *
 * DELETE (via query param ?taskType=xxx) → Remove a task type.
 *        Defaults are soft-deleted (per-client override; restorable, and
 *        existing visits are untouched). Custom types also remove their
 *        client-specific subtask templates.
 *
 * All changes affect FUTURE visits only. Existing visits keep the tasks they
 * were created with, so historical data and carry-forward relationships stay
 * intact.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/middleware";
import { isAdminRole } from "@/lib/auth/roles";
import {
  DEFAULT_TASK_TYPES,
  DEFAULT_TASK_TYPE_SET,
  titleToTaskType,
  taskTypeToTitle,
  syncClientPendingVisits,
} from "@/lib/utils/create-visit";

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { clientId } = await params;

  try {
    const [client, clientTemplates, globalTemplates, taskTypeConfigs, activeVisit] = await Promise.all([
      prisma.client.findUnique({
        where: { id: clientId },
        select: { id: true, name: true, code: true, assignedExec: { select: { id: true, name: true } } },
      }),
      prisma.subtaskTemplate.findMany({
        where: { clientId },
        orderBy: [{ taskType: "asc" }, { orderIndex: "asc" }],
      }),
      prisma.subtaskTemplate.findMany({
        where: { clientId: null },
        orderBy: [{ taskType: "asc" }, { orderIndex: "asc" }],
      }),
      prisma.clientTaskType.findMany({ where: { clientId } }),
      // Carry-forward section (duplicate-client business rule): carried
      // subtasks live on the client's ACTIVE visit, not in the template
      // config. They are shown as a SEPARATE section - copied/normal tasks
      // and carry-forward tasks must never merge into one list.
      prisma.visit.findFirst({
        where: { clientId, status: { in: ["PENDING", "OPEN"] } },
        orderBy: { scheduledDate: "desc" },
        select: {
          id: true,
          visitNumber: true,
          tasks: {
            orderBy: { orderIndex: "asc" },
            select: {
              taskType: true,
              title: true,
              subtasks: {
                where: { isCarriedForward: true },
                orderBy: { createdAt: "asc" },
                select: {
                  id: true,
                  title: true,
                  isCompleted: true,
                  sourceSubtask: {
                    select: { task: { select: { visit: { select: { visitNumber: true } } } } },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    // Group carried subtasks under their original main task (hierarchy and
    // order preserved). Empty when the client has no carried work.
    const carryForwardGroups = (activeVisit?.tasks ?? [])
      .filter((t) => t.subtasks.length > 0)
      .map((t) => ({
        taskType: t.taskType,
        taskTitle: t.title,
        subtasks: t.subtasks.map((s) => ({
          id: s.id,
          title: s.title.replace("[CARRY-FORWARD] ", ""),
          isCompleted: s.isCompleted,
          sourceVisitNumber: s.sourceSubtask?.task.visit.visitNumber ?? null,
        })),
      }));

    const carryForward = activeVisit && carryForwardGroups.length > 0
      ? { visitId: activeVisit.id, visitNumber: activeVisit.visitNumber, groups: carryForwardGroups }
      : null;

    const configByType = new Map(taskTypeConfigs.map((c) => [c.taskType, c]));

    // Build the task type list: defaults + custom types (registered via
    // ClientTaskType and/or legacy client-specific templates)
    const clientTaskTypeSet = new Set(clientTemplates.map((t) => t.taskType));
    const customTaskTypes = [
      ...new Set([
        ...taskTypeConfigs.filter((c) => !DEFAULT_TASK_TYPE_SET.has(c.taskType)).map((c) => c.taskType),
        ...[...clientTaskTypeSet].filter((tt) => !DEFAULT_TASK_TYPE_SET.has(tt)),
      ]),
    ];

    const allTaskTypes = [
      ...DEFAULT_TASK_TYPES.map((d) => {
        const cfg = configByType.get(d.type);
        return {
          type: d.type,
          title: cfg?.title ?? d.title,
          isDefault: true,
          isDeleted: cfg?.isDeleted ?? false,
          orderIndex: cfg?.orderIndex ?? d.orderIndex,
        };
      }),
      ...customTaskTypes.map((type, i) => {
        const cfg = configByType.get(type);
        return {
          type,
          title: cfg?.title ?? taskTypeToTitle(type),
          isDefault: false,
          isDeleted: cfg?.isDeleted ?? false,
          orderIndex: cfg?.orderIndex ?? DEFAULT_TASK_TYPES.length + i,
        };
      }),
    ].sort((a, b) => a.orderIndex - b.orderIndex);

    // For each task type, resolve subtasks
    const taskTypes = allTaskTypes.map(({ type, title, isDefault, isDeleted, orderIndex }) => {
      const clientSpecific = clientTemplates.filter((t) => t.taskType === type);
      const global = globalTemplates.filter((t) => t.taskType === type);

      // If client has specific templates for this type, use them; else use global
      const resolvedSubtasks = clientSpecific.length > 0 ? clientSpecific : global;
      const isUsingClientSpecific = clientSpecific.length > 0;

      return {
        type,
        title,
        isDefault,
        isDeleted,
        orderIndex,
        isUsingClientSpecific,
        subtaskCount: resolvedSubtasks.filter((t) => t.isActive).length,
        subtasks: resolvedSubtasks,
      };
    });

    return NextResponse.json({ client, taskTypes, carryForward });
  } catch (error) {
    console.error("Get client task config error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST (Add custom task type) ──────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { clientId } = await params;

  try {
    const body = await request.json();
    const { title } = body;

    if (!title?.trim()) return NextResponse.json({ error: "Task type title is required" }, { status: 400 });

    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true } });
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    // Generate a unique task type key from the title
    let taskType = titleToTaskType(title);

    // Ensure no collision with existing types for this client
    const existing = await prisma.clientTaskType.findFirst({
      where: { clientId, taskType },
      select: { id: true },
    });
    const existingTemplate = await prisma.subtaskTemplate.findFirst({
      where: { clientId, taskType },
      select: { id: true },
    });
    if (existing || existingTemplate || DEFAULT_TASK_TYPE_SET.has(taskType)) {
      // Append a short timestamp suffix to make it unique
      taskType = `${taskType}_${Date.now().toString(36).toUpperCase()}`;
    }

    // Determine the next order position (append at the end)
    const configs = await prisma.clientTaskType.findMany({ where: { clientId }, select: { orderIndex: true } });
    const maxOrder = Math.max(
      DEFAULT_TASK_TYPES.length - 1,
      ...configs.map((c) => c.orderIndex ?? 0)
    );

    // Register the custom main task type for this client
    const config = await prisma.clientTaskType.create({
      data: {
        clientId,
        taskType,
        title: title.trim(),
        orderIndex: maxOrder + 1,
      },
    });

    await prisma.activityLog.create({
      data: {
        userId: user.userId,
        action: "SUBTASK_TEMPLATE_UPDATED",
        metadata: { action: "custom_task_type_created", taskType, taskTitle: title, clientId, clientName: client.name },
      },
    });

    // Propagate immediately to already-scheduled PENDING visits
    await syncClientPendingVisits(clientId).catch((e) => console.error("[task-config-sync]", e));

    return NextResponse.json({ taskType, title: title.trim(), config }, { status: 201 });
  } catch (error) {
    console.error("Add custom task type error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── PATCH (Rename / Reorder / Restore main task types) ──────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { clientId } = await params;

  try {
    const body = await request.json();

    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true } });
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    // ── Bulk reorder: { order: ["TYPE_A", "TYPE_B", ...] } ────────────────
    if (Array.isArray(body.order)) {
      const order: string[] = body.order.filter((t: unknown) => typeof t === "string");
      await Promise.all(
        order.map((taskType, index) =>
          prisma.clientTaskType.upsert({
            where: { clientId_taskType: { clientId, taskType } },
            create: { clientId, taskType, orderIndex: index },
            update: { orderIndex: index },
          })
        )
      );

      await prisma.activityLog.create({
        data: {
          userId: user.userId,
          action: "SUBTASK_TEMPLATE_UPDATED",
          metadata: { action: "main_tasks_reordered", clientId, clientName: client.name, order },
        },
      });

      await syncClientPendingVisits(clientId).catch((e) => console.error("[task-config-sync]", e));
      return NextResponse.json({ success: true });
    }

    // ── Rename: { taskType, title } ───────────────────────────────────────
    const { taskType, title, restore } = body as { taskType?: string; title?: string; restore?: boolean };
    if (!taskType) return NextResponse.json({ error: "taskType is required" }, { status: 400 });

    if (restore) {
      await prisma.clientTaskType.upsert({
        where: { clientId_taskType: { clientId, taskType } },
        create: { clientId, taskType, isDeleted: false },
        update: { isDeleted: false },
      });
      await syncClientPendingVisits(clientId).catch((e) => console.error("[task-config-sync]", e));
      return NextResponse.json({ success: true });
    }

    if (!title?.trim()) return NextResponse.json({ error: "title is required" }, { status: 400 });

    await prisma.clientTaskType.upsert({
      where: { clientId_taskType: { clientId, taskType } },
      create: { clientId, taskType, title: title.trim() },
      update: { title: title.trim() },
    });

    await prisma.activityLog.create({
      data: {
        userId: user.userId,
        action: "SUBTASK_TEMPLATE_UPDATED",
        metadata: { action: "main_task_renamed", taskType, newTitle: title.trim(), clientId, clientName: client.name },
      },
    });

    // Propagate immediately to already-scheduled PENDING visits
    await syncClientPendingVisits(clientId).catch((e) => console.error("[task-config-sync]", e));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update main task type error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── DELETE (Remove a task type — default OR custom) ─────────────────────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { clientId } = await params;
  const { searchParams } = new URL(request.url);
  const taskType = searchParams.get("taskType");

  if (!taskType) return NextResponse.json({ error: "taskType query param is required" }, { status: 400 });

  try {
    // Soft-delete via per-client override. Existing visits are untouched;
    // only FUTURE visits for this client skip the task type. Defaults can be
    // restored later (PATCH { taskType, restore: true }).
    await prisma.clientTaskType.upsert({
      where: { clientId_taskType: { clientId, taskType } },
      create: { clientId, taskType, isDeleted: true },
      update: { isDeleted: true },
    });

    // Custom types additionally drop their client-specific subtask templates
    let deletedTemplates = 0;
    if (!DEFAULT_TASK_TYPE_SET.has(taskType)) {
      const deleted = await prisma.subtaskTemplate.deleteMany({
        where: { clientId, taskType },
      });
      deletedTemplates = deleted.count;
    }

    await prisma.activityLog.create({
      data: {
        userId: user.userId,
        action: "SUBTASK_TEMPLATE_UPDATED",
        metadata: {
          action: DEFAULT_TASK_TYPE_SET.has(taskType) ? "default_task_type_deleted" : "custom_task_type_deleted",
          taskType,
          clientId,
          deletedTemplates,
        },
      },
    });

    // Propagate immediately to already-scheduled PENDING visits
    await syncClientPendingVisits(clientId).catch((e) => console.error("[task-config-sync]", e));

    return NextResponse.json({ success: true, deleted: deletedTemplates });
  } catch (error) {
    console.error("Delete task type error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
