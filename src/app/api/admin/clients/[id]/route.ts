import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/middleware";
import { isAdminRole } from "@/lib/auth/roles";
import { createVisitForClient } from "@/lib/utils/create-visit";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  try {
    const client = await prisma.client.findUnique({
      where: { id },
      include: {
        assignedExec: { select: { id: true, name: true, email: true } },
        visits: {
          include: {
            executive: { select: { id: true, name: true } },
            tasks: { include: { subtasks: { select: { isCompleted: true } } } },
          },
          orderBy: { scheduledDate: "desc" },
        },
      },
    });

    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    const visits = client.visits.map((v: any) => {
      const total = v.tasks.reduce((s, t) => s + t.subtasks.length, 0);
      const done = v.tasks.reduce((s, t) => s + t.subtasks.filter((st) => st.isCompleted).length, 0);
      const progress = total === 0 ? 0 : Math.round((done / total) * 100);
      return { id: v.id, visitNumber: v.visitNumber, executive: v.executive, status: v.status, scheduledDate: v.scheduledDate, closedAt: v.closedAt, progress };
    });

    return NextResponse.json({ client: { ...client, visits } });
  } catch (error) {
    console.error("Get client error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  try {
    const body = await request.json();
    const { name, contactPerson, address, phone, email, reportEmails, assignedExecId, startDate, endDate, isArchived } = body;

    const existing = await prisma.client.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    // Detect if the executive assignment is changing
    const prevExecId = existing.assignedExecId;
    const newExecId = assignedExecId !== undefined ? (assignedExecId || null) : prevExecId;
    const execChanged = assignedExecId !== undefined && newExecId !== prevExecId;
    const execAssigned = execChanged && !!newExecId;

    // Resolve the effective visit start/end dates for this save (used below to
    // keep the client's active visit in sync with the Start/End Date fields).
    const newStartDate = startDate !== undefined ? (startDate ? new Date(startDate) : null) : existing.startDate;
    const newEndDate = endDate !== undefined ? (endDate ? new Date(endDate) : null) : existing.endDate;
    const datesChanged =
      (startDate !== undefined && (existing.startDate?.getTime() ?? null) !== (newStartDate?.getTime() ?? null)) ||
      (endDate !== undefined && (existing.endDate?.getTime() ?? null) !== (newEndDate?.getTime() ?? null));

    const updated = await prisma.client.update({
      where: { id },
      data: {
        ...(name && { name: name.trim() }),
        ...(contactPerson && { contactPerson: contactPerson.trim() }),
        ...(address && { address: address.trim() }),
        ...(phone !== undefined && { phone: phone || null }),
        ...(email !== undefined && { email: email || null }),
        ...(reportEmails !== undefined && { reportEmails: Array.isArray(reportEmails) ? reportEmails : [] }),
        ...(assignedExecId !== undefined && { assignedExecId: assignedExecId || null }),
        ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
        ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
        ...(isArchived !== undefined && { isArchived }),
      },
      include: { assignedExec: { select: { id: true, name: true, email: true } } },
    });

    const wasArchived = isArchived === true && !existing.isArchived;
    await prisma.activityLog.create({
      data: {
        userId: user.userId,
        action: wasArchived ? "CLIENT_ARCHIVED" : "CLIENT_UPDATED",
        metadata: {
          clientId: id,
          clientName: updated.name,
          updatedBy: user.name,
          ...(execChanged && { prevExecId, newExecId }),
        },
      },
    });

    // ── Sync the client's active visit with the new executive / dates ────────
    // A client has at most one active (PENDING/OPEN) visit at a time. When the
    // assigned executive or the Start/End Date changes, that SAME visit row
    // must be updated in place — never left on the old executive while a
    // second visit is created for the new one (that produced the "both
    // executives own the visit" duplication bug + wrong visit date bug).
    let visitInfo = null;
    let visitError: string | null = null;
    if (execAssigned || (datesChanged && newExecId)) {
      try {
        const activeVisits = await prisma.visit.findMany({
          where: { clientId: id, status: { in: ["PENDING", "OPEN"] } },
          include: { executive: { select: { id: true, name: true } } },
        });

        if (activeVisits.length > 0) {
          for (const visit of activeVisits) {
            const reassigning = execChanged && !!newExecId && visit.executiveId !== newExecId;

            await prisma.visit.update({
              where: { id: visit.id },
              data: {
                ...(reassigning ? { executiveId: newExecId! } : {}),
                ...(newStartDate ? { scheduledDate: newStartDate } : {}),
                ...(endDate !== undefined ? { endDate: newEndDate } : {}),
              },
            });

            if (reassigning) {
              await prisma.visitReassignment.create({
                data: {
                  visitId: visit.id,
                  fromExecutiveId: visit.executiveId,
                  toExecutiveId: newExecId!,
                  reason: "Client executive assignment changed",
                  reassignedById: user.userId,
                },
              });
              await prisma.activityLog.create({
                data: {
                  visitId: visit.id,
                  userId: user.userId,
                  action: "VISIT_REASSIGNED",
                  metadata: {
                    visitNumber: visit.visitNumber,
                    clientName: updated.name,
                    fromExecutiveId: visit.executiveId,
                    fromExecutiveName: visit.executive.name,
                    toExecutiveId: newExecId,
                    reassignedBy: user.name,
                    reason: "Client executive assignment changed",
                  },
                },
              });
            }
          }
          visitInfo = { visitsSynced: activeVisits.length };
        } else if (execAssigned) {
          // No active visit exists yet — create one on the correct date
          visitInfo = await createVisitForClient(id, newExecId!, user.userId, {
            scheduledDate: newStartDate ?? undefined,
            endDate: newEndDate ?? undefined,
          });
        }
      } catch (visitErr) {
        console.error("[create-visit] Failed to sync visit after client update:", visitErr);
        visitError = visitErr instanceof Error ? visitErr.message : String(visitErr);
      }
    }

    return NextResponse.json({
      client: updated,
      visitCreated: visitInfo,
      ...(visitError && { visitWarning: visitError }),
    });
  } catch (error) {
    console.error("Update client error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── DELETE /api/admin/clients/[id] ───────────────────────────────────────────
// Permanently deletes a client together with its full visit history.
//
// Only some of the chain cascades at the database level, so the rest is removed
// here in foreign-key-safe order:
//   Client   → ClientTaskType, SubtaskTemplate   cascade (schema)
//   Visit    → Task → Subtask                    cascade (schema)
//   Visit    ← ActivityLog / VisitReassignment / VisitDelegation
//                                                NO cascade — deleted below
//   Subtask  ← Subtask.sourceSubtaskId (carry-forward)
//                                                NO cascade — cleared below
// Everything runs in one transaction, so a failure part-way leaves the client
// and its history exactly as they were rather than half-deleted.
//
// Admin-only, unchanged: executives never reach this handler.

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  try {
    const existing = await prisma.client.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!existing) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    const removed = await prisma.$transaction(async (tx) => {
      const visits = await tx.visit.findMany({ where: { clientId: id }, select: { id: true } });
      const visitIds = visits.map((v) => v.id);

      let taskCount = 0;
      let subtaskCount = 0;
      let activityLogs = 0;
      let reassignments = 0;
      let delegations = 0;

      if (visitIds.length > 0) {
        const tasks = await tx.task.findMany({ where: { visitId: { in: visitIds } }, select: { id: true } });
        const taskIds = tasks.map((t) => t.id);
        taskCount = taskIds.length;

        const subtasks = taskIds.length
          ? await tx.subtask.findMany({ where: { taskId: { in: taskIds } }, select: { id: true } })
          : [];
        const subtaskIds = subtasks.map((s) => s.id);
        subtaskCount = subtaskIds.length;

        // A carry-forward subtask points back at the subtask it came from via
        // sourceSubtaskId, which has no cascade rule. Clear every pointer INTO
        // the rows about to be deleted first, otherwise the Task→Subtask
        // cascade below trips that foreign key.
        if (subtaskIds.length > 0) {
          await tx.subtask.updateMany({
            where: { sourceSubtaskId: { in: subtaskIds } },
            data: { sourceSubtaskId: null },
          });
        }

        activityLogs = (await tx.activityLog.deleteMany({ where: { visitId: { in: visitIds } } })).count;
        reassignments = (await tx.visitReassignment.deleteMany({ where: { visitId: { in: visitIds } } })).count;
        delegations = (await tx.visitDelegation.deleteMany({ where: { visitId: { in: visitIds } } })).count;

        // Tasks and their subtasks cascade from the visit.
        await tx.visit.deleteMany({ where: { id: { in: visitIds } } });
      }

      // ClientTaskType and SubtaskTemplate cascade from the client.
      await tx.client.delete({ where: { id } });

      return { visits: visitIds.length, tasks: taskCount, subtasks: subtaskCount, activityLogs, reassignments, delegations };
    });

    await prisma.activityLog.create({
      data: {
        userId: user.userId,
        action: "CLIENT_DELETED",
        metadata: { clientId: id, clientName: existing.name, deletedBy: user.name, removed },
      },
    });

    return NextResponse.json({ success: true, removed });
  } catch (error) {
    console.error("Delete client error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
