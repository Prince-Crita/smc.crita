/**
 * POST /api/admin/clients/[id]/duplicate
 *
 * Duplicates a client for weekly-recurring engagements. Copies:
 *   • All client-specific main-task configuration (renames/deletes/order/customs)
 *   • All client-specific subtask templates
 *   • Assigned executive
 *   • Contact/visit configuration (contact person, address, phone, emails,
 *     report recipients, engagement start/end dates)
 *
 * Body: { name: string; visitDate?: string }
 *   name      → the new client's name (admin-edited)
 *   visitDate → optional; when provided (and the source client has an
 *               assigned executive) the first visit is scheduled on it,
 *               otherwise "now" is used.
 *
 * A unique client code is generated from the source code (SRC → SRC-2,
 * SRC-3, ...). The first visit is auto-created immediately so the duplicate
 * shows up on Admin/Executive dashboards, Visits, and the Calendar right
 * away — same flow as regular client creation.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/middleware";
import { createVisitForClient } from "@/lib/utils/create-visit";

// ─── GET: pending tasks available for carry-forward selection ───────────────
// Returns the source client's most recent visit and its main tasks that
// still have incomplete subtasks. The Duplicate Client modal shows these as
// checkboxes so the admin decides which pending tasks become Carry Forward
// in the duplicated visit (Business rule: normal duplicated tasks ≠ carry-
// forward tasks - only SELECTED pending tasks are carried).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  try {
    const sourceVisit = await prisma.visit.findFirst({
      where: { clientId: id },
      orderBy: { scheduledDate: "desc" },
      select: {
        id: true,
        visitNumber: true,
        scheduledDate: true,
        status: true,
        tasks: {
          orderBy: { orderIndex: "asc" },
          select: {
            taskType: true,
            title: true,
            subtasks: {
              where: { isCompleted: false },
              select: { id: true, title: true },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    });

    const pendingTasks = (sourceVisit?.tasks ?? [])
      .filter((t) => t.subtasks.length > 0)
      .map((t) => ({
        taskType: t.taskType,
        title: t.title,
        incompleteCount: t.subtasks.length,
        incompleteSubtasks: t.subtasks,
      }));

    return NextResponse.json({
      sourceVisit: sourceVisit
        ? { id: sourceVisit.id, visitNumber: sourceVisit.visitNumber, scheduledDate: sourceVisit.scheduledDate, status: sourceVisit.status }
        : null,
      pendingTasks,
    });
  } catch (error) {
    console.error("Duplicate client pending-tasks error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  try {
    const body = await request.json().catch(() => ({}));
    const { name, visitDate, carryForwardTaskTypes } = body as {
      name?: string;
      visitDate?: string;
      /** Main task types (from GET) whose incomplete subtasks should be
       *  carried into the duplicated visit as Carry Forward items. */
      carryForwardTaskTypes?: string[];
    };

    if (!name?.trim()) return NextResponse.json({ error: "New client name is required" }, { status: 400 });

    const source = await prisma.client.findUnique({
      where: { id },
      include: {
        subtaskTemplates: true,
        taskTypeConfigs: true,
      },
    });
    if (!source) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    // ── Generate a unique code: SRC → SRC-2, SRC-3, ... ────────────────────
    const baseCode = source.code.replace(/-\d+$/, "");
    let newCode = "";
    for (let i = 2; i < 100; i++) {
      const candidate = `${baseCode}-${i}`;
      const exists = await prisma.client.findUnique({ where: { code: candidate }, select: { id: true } });
      if (!exists) { newCode = candidate; break; }
    }
    if (!newCode) return NextResponse.json({ error: "Could not generate a unique client code" }, { status: 500 });

    // ── Create the duplicate client ─────────────────────────────────────────
    const newClient = await prisma.client.create({
      data: {
        name: name.trim(),
        code: newCode,
        contactPerson: source.contactPerson,
        address: source.address,
        phone: source.phone,
        email: source.email,
        reportEmails: source.reportEmails,
        assignedExecId: source.assignedExecId,
        startDate: source.startDate,
        endDate: source.endDate,
      },
      include: { assignedExec: { select: { id: true, name: true, email: true } } },
    });

    // ── Copy client-specific subtask templates ──────────────────────────────
    if (source.subtaskTemplates.length > 0) {
      await prisma.subtaskTemplate.createMany({
        data: source.subtaskTemplates.map((t) => ({
          clientId: newClient.id,
          taskType: t.taskType,
          title: t.title,
          orderIndex: t.orderIndex,
          isActive: t.isActive,
        })),
      });
    }

    // ── Copy main-task configuration (renames / deletes / order / customs) ──
    if (source.taskTypeConfigs.length > 0) {
      await prisma.clientTaskType.createMany({
        data: source.taskTypeConfigs.map((c) => ({
          clientId: newClient.id,
          taskType: c.taskType,
          title: c.title,
          orderIndex: c.orderIndex,
          isDeleted: c.isDeleted,
        })),
      });
    }

    await prisma.activityLog.create({
      data: {
        userId: user.userId,
        action: "CLIENT_ADDED",
        metadata: {
          clientName: newClient.name,
          clientCode: newClient.code,
          duplicatedFrom: source.name,
          duplicatedFromId: source.id,
          addedBy: user.name,
        },
      },
    });

    // ── Auto-create the first visit (same flow as regular client creation) ──
    let visitInfo = null;
    let visitError: string | null = null;
    let carriedCount = 0;
    if (newClient.assignedExecId) {
      try {
        visitInfo = await createVisitForClient(newClient.id, newClient.assignedExecId, user.userId, {
          scheduledDate: visitDate ? new Date(visitDate) : undefined,
        });

        // ── Selective carry-forward (admin-chosen pending tasks) ─────────
        // Only the SELECTED pending tasks from the source client's latest
        // visit become Carry Forward items in the duplicated visit. They are
        // real carry-forward rows (isCarriedForward + sourceSubtaskId), so
        // the CF badge, CF page, counts, dashboards and history all work
        // exactly like close-time carry-forward.
        const selected = (carryForwardTaskTypes ?? []).filter((t) => typeof t === "string");
        if (selected.length > 0) {
          const sourceVisit = await prisma.visit.findFirst({
            where: { clientId: source.id },
            orderBy: { scheduledDate: "desc" },
            select: {
              id: true,
              visitNumber: true,
              tasks: {
                select: {
                  taskType: true,
                  title: true,
                  // orderBy preserves the original subtask order in the copy
                  subtasks: { where: { isCompleted: false }, select: { id: true, title: true }, orderBy: { createdAt: "asc" } },
                },
              },
            },
          });

          if (sourceVisit && visitInfo) {
            const newVisitTasks = await prisma.task.findMany({
              where: { visitId: visitInfo.visitId },
              select: { id: true, taskType: true, orderIndex: true, title: true },
            });
            const newTaskByType = new Map(newVisitTasks.map((t) => [t.taskType, t]));
            let maxOrder = newVisitTasks.reduce((m, t) => Math.max(m, t.orderIndex), -1);

            for (const taskType of selected) {
              const sourceTask = sourceVisit.tasks.find((t) => t.taskType === taskType);
              if (!sourceTask || sourceTask.subtasks.length === 0) continue;

              // The duplicated visit may not include this task type (config
              // changed) - create it rather than dropping the selection.
              let destTask = newTaskByType.get(taskType);
              if (!destTask) {
                const created = await prisma.task.create({
                  data: {
                    visitId: visitInfo.visitId,
                    taskType,
                    title: sourceTask.title,
                    status: "PENDING",
                    orderIndex: ++maxOrder,
                  },
                  select: { id: true, taskType: true, orderIndex: true, title: true },
                });
                destTask = created;
                newTaskByType.set(taskType, created);
              }

              await prisma.subtask.createMany({
                data: sourceTask.subtasks.map((s) => ({
                  taskId: destTask!.id,
                  title: s.title.startsWith("[CARRY-FORWARD] ") ? s.title : `[CARRY-FORWARD] ${s.title}`,
                  isCompleted: false,
                  isCarriedForward: true,
                  sourceSubtaskId: s.id,
                })),
                // Respect the @@unique([taskId, sourceSubtaskId]) guard -
                // a retried/double-submitted duplication can never stack
                // duplicate carry-forward rows.
                skipDuplicates: true,
              });
              carriedCount += sourceTask.subtasks.length;
            }

            if (carriedCount > 0) {
              await prisma.activityLog.create({
                data: {
                  visitId: visitInfo.visitId,
                  userId: user.userId,
                  action: "CARRY_FORWARD_APPLIED",
                  metadata: {
                    reason: "DUPLICATE_CLIENT_SELECTION",
                    fromVisitId: sourceVisit.id,
                    fromVisitNumber: sourceVisit.visitNumber,
                    toVisitId: visitInfo.visitId,
                    toVisitNumber: visitInfo.visitNumber,
                    carriedCount,
                    selectedTaskTypes: selected,
                  },
                },
              });
            }
          }
        }
      } catch (visitErr) {
        console.error("[duplicate-client] Failed to auto-create visit:", visitErr);
        visitError = visitErr instanceof Error ? visitErr.message : String(visitErr);
      }
    }

    return NextResponse.json(
      { client: newClient, visitCreated: visitInfo, carriedCount, ...(visitError && { visitWarning: visitError }) },
      { status: 201 }
    );
  } catch (error) {
    console.error("Duplicate client error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
