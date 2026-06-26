/**
 * /api/admin/task-config/[clientId]
 *
 * GET  → Full task configuration for a specific client.
 *        Returns all 6 default task types + any client-specific custom task types,
 *        with the subtask templates resolved (client-specific > global fallback).
 *
 * POST → Add a new custom task type for this client.
 *        Body: { title: string }
 *        Generates the taskType key and creates an initial placeholder template.
 *
 * DELETE (via query param ?taskType=xxx) → Remove all templates for a custom task type
 *        from this client. Cannot delete default task types this way.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/middleware";
import {
  DEFAULT_TASK_TYPES,
  DEFAULT_TASK_TYPE_SET,
  titleToTaskType,
  taskTypeToTitle,
} from "@/lib/utils/create-visit";

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { clientId } = await params;

  try {
    const [client, clientTemplates, globalTemplates] = await Promise.all([
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
    ]);

    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    // Build the task type list: defaults + any client-specific custom types
    const clientTaskTypeSet = new Set(clientTemplates.map((t) => t.taskType));
    const customTaskTypes = [...clientTaskTypeSet].filter((tt) => !DEFAULT_TASK_TYPE_SET.has(tt));

    const allTaskTypes = [
      ...DEFAULT_TASK_TYPES.map((d) => ({ type: d.type, title: d.title, isDefault: true })),
      ...customTaskTypes.map((type) => ({ type, title: taskTypeToTitle(type), isDefault: false })),
    ];

    // For each task type, resolve subtasks
    const taskTypes = allTaskTypes.map(({ type, title, isDefault }) => {
      const clientSpecific = clientTemplates.filter((t) => t.taskType === type);
      const global = globalTemplates.filter((t) => t.taskType === type);

      // If client has specific templates for this type, use them; else use global
      const resolvedSubtasks = clientSpecific.length > 0 ? clientSpecific : global;
      const isUsingClientSpecific = clientSpecific.length > 0;

      return {
        type,
        title,
        isDefault,
        isUsingClientSpecific,
        subtaskCount: resolvedSubtasks.filter((t) => t.isActive).length,
        subtasks: resolvedSubtasks,
      };
    });

    return NextResponse.json({ client, taskTypes });
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
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
    const existing = await prisma.subtaskTemplate.findFirst({
      where: { clientId, taskType },
      select: { id: true },
    });
    if (existing || DEFAULT_TASK_TYPE_SET.has(taskType)) {
      // Append a short timestamp suffix to make it unique
      taskType = `${taskType}_${Date.now().toString(36).toUpperCase()}`;
    }

    // Create a placeholder subtask template to "register" this task type for the client
    // The admin can then add real subtasks from the UI
    const template = await prisma.subtaskTemplate.create({
      data: {
        taskType,
        title: "Add your first subtask",
        orderIndex: 0,
        isActive: true,
        clientId,
      },
    });

    await prisma.activityLog.create({
      data: {
        userId: user.userId,
        action: "SUBTASK_TEMPLATE_UPDATED",
        metadata: { action: "custom_task_type_created", taskType, taskTitle: title, clientId, clientName: client.name },
      },
    });

    return NextResponse.json({ taskType, title, template }, { status: 201 });
  } catch (error) {
    console.error("Add custom task type error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── DELETE (Remove custom task type) ─────────────────────────────────────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { clientId } = await params;
  const { searchParams } = new URL(request.url);
  const taskType = searchParams.get("taskType");

  if (!taskType) return NextResponse.json({ error: "taskType query param is required" }, { status: 400 });
  if (DEFAULT_TASK_TYPE_SET.has(taskType))
    return NextResponse.json({ error: "Cannot delete a default task type" }, { status: 400 });

  try {
    const deleted = await prisma.subtaskTemplate.deleteMany({
      where: { clientId, taskType },
    });

    await prisma.activityLog.create({
      data: {
        userId: user.userId,
        action: "SUBTASK_TEMPLATE_UPDATED",
        metadata: { action: "custom_task_type_deleted", taskType, clientId, count: deleted.count },
      },
    });

    return NextResponse.json({ success: true, deleted: deleted.count });
  } catch (error) {
    console.error("Delete custom task type error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
