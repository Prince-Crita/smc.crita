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
 * Body: { name: string; startDate?: string | null; endDate?: string | null }
 *   name      → the new client's name (admin-edited)
 *   startDate → Visit Start Date. Same field and semantics as the Edit Client
 *               popup: stored on Client.startDate AND used as the created
 *               visit's scheduledDate. Falls back to the source client's
 *               startDate, then to "now".
 *   endDate   → Visit End Date. Stored on Client.endDate AND used as the
 *               created visit's endDate (the carry-forward window boundary —
 *               see the Visit.endDate doc). Falls back to the source client's
 *               endDate.
 *
 * Because both dates are persisted on the client AND on the visit in one
 * request, the duplicate is complete the moment it is created — it shows up
 * with the correct dates on every dashboard, calendar, visit list and report,
 * and the assigned executive receives it immediately. No follow-up edit.
 *
 * A unique client code is generated from the source code (SRC → SRC-2,
 * SRC-3, ...). The first visit is auto-created immediately so the duplicate
 * shows up on Admin/Executive dashboards, Visits, and the Calendar right
 * away — same flow as regular client creation.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/middleware";
import { isAdminRole } from "@/lib/auth/roles";
import { createVisitForClient } from "@/lib/utils/create-visit";
import { applyAssignment, normalizeAssignment } from "@/lib/utils/visit-assignment";

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
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
        // Previous assignment (§5) — shown before duplicating so the admin can
        // keep it or edit it.
        visitType: true,
        executive: { select: { id: true, name: true } },
        assignments: {
          select: { role: true, executive: { select: { id: true, name: true } } },
        },
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

    // §5 — "Previous Assignment" block for the Duplicate Client modal.
    const previousAssignment = sourceVisit
      ? {
          visitType: sourceVisit.visitType,
          teamLead: { id: sourceVisit.executive.id, name: sourceVisit.executive.name },
          teamMembers: sourceVisit.assignments
            .filter((a) => a.role !== "LEAD")
            .map((a) => ({ id: a.executive.id, name: a.executive.name })),
        }
      : null;

    return NextResponse.json({
      sourceVisit: sourceVisit
        ? { id: sourceVisit.id, visitNumber: sourceVisit.visitNumber, scheduledDate: sourceVisit.scheduledDate, status: sourceVisit.status }
        : null,
      previousAssignment,
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
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  try {
    const body = await request.json().catch(() => ({}));
    const { name, startDate, endDate, carryForwardTaskTypes, assignment } = body as {
      name?: string;
      startDate?: string | null;
      endDate?: string | null;
      /** Main task types (from GET) whose incomplete subtasks should be
       *  carried into the duplicated visit as Carry Forward items. */
      carryForwardTaskTypes?: string[];
      /** §5 — assignment for the duplicate. Omit to keep the source client's
       *  assigned executive; send one to override it (Edit Assignment). */
      assignment?: { visitType?: "SOLO" | "TEAM"; executiveId?: string; memberIds?: string[] };
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

    // ── Resolve Visit Start / End Date ──────────────────────────────────────
    // Explicitly provided (including explicit null) wins; otherwise inherit the
    // source client's window. Validated exactly like POST /api/admin/visits.
    const parseDate = (v: string | null | undefined, fallback: Date | null): Date | null =>
      v === undefined ? fallback : v ? new Date(v) : null;

    if (startDate && isNaN(new Date(startDate).getTime()))
      return NextResponse.json({ error: "Invalid Visit Start Date" }, { status: 400 });
    if (endDate && isNaN(new Date(endDate).getTime()))
      return NextResponse.json({ error: "Invalid Visit End Date" }, { status: 400 });

    const newStartDate = parseDate(startDate, source.startDate);
    const newEndDate = parseDate(endDate, source.endDate);

    if (newStartDate && newEndDate && newEndDate < newStartDate) {
      return NextResponse.json(
        { error: "Visit End Date cannot be before the Visit Start Date" },
        { status: 400 }
      );
    }

    // ── Validate the requested assignment BEFORE anything is written ────────
    // This used to be validated after the client row, its subtask templates
    // and its task configuration had already been created, so a rejected
    // assignment (e.g. "Team Visit" with no members) returned 400 while
    // leaving a fully-formed orphan client behind — and burned a client code
    // on every retry. Nothing is created until the payload is known good.
    const chosen = normalizeAssignment(
      { visitType: assignment?.visitType, executiveId: assignment?.executiveId, memberIds: assignment?.memberIds },
      source.assignedExecId ?? undefined
    );
    if (assignment && chosen.error) {
      return NextResponse.json({ error: chosen.error }, { status: 400 });
    }

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
        // The duplicate follows the assignment the admin confirmed in the
        // modal: the chosen executive / team lead when they edited it, the
        // source client's executive when they kept it. Without this the
        // Clients list showed the duplicate under the OLD executive while its
        // visit belonged to the new one.
        assignedExecId: chosen.value?.leadId ?? source.assignedExecId,
        startDate: newStartDate,
        endDate: newEndDate,
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
    // §5 — assignment for the DUPLICATE (validated above, before any write).
    // When the admin sends one it is used; when omitted, the duplicate keeps
    // the source client's assigned executive exactly as before. Either way the
    // ORIGINAL client's assignment is never written to — only `newClient` is
    // touched.
    const leadForVisit = chosen.value?.leadId ?? newClient.assignedExecId;

    if (leadForVisit) {
      try {
        visitInfo = await createVisitForClient(newClient.id, leadForVisit, user.userId, {
          // The duplicate is a brand-new client row, so it can never have a
          // pre-existing active visit — the dates below are always applied.
          scheduledDate: newStartDate ?? undefined,
          endDate: newEndDate ?? undefined,
        });

        // Apply the chosen SOLO/TEAM assignment to the freshly created visit.
        if (visitInfo?.visitId && chosen.value?.visitType === "TEAM") {
          await applyAssignment(prisma, visitInfo.visitId, chosen.value);
        }

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
