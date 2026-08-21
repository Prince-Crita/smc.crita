import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { prisma } from "@/lib/db/prisma";
import { executiveVisitScope } from "@/lib/utils/visit-access";
import { toMidnightIST } from "@/lib/utils/attendance";
import { CARRY_FORWARD_NOTE_PREFIX } from "@/lib/utils/carry-forward";
import {
  CARRY_FORWARD_SUBTASKS_ONLY_MARKER,
  createVisitForClient,
  ensureCarryForwardVisitHasClientTasks,
  isSubtaskOnlyCarryForwardVisit,
} from "@/lib/utils/create-visit";

// ─── GET /api/carry-forward ──────────────────────────────────────────────────
// The executive's Carry Forward popup (§6).
//
// Returns ONLY genuine carry-forward subtasks — rows with isCarriedForward
// true. Normal pending tasks are deliberately excluded, which is the whole
// point of this endpoint: the popup must not be a second "pending" list.
//
// Each item carries client, original visit/date, main task, subtask,
// executive and the visit's current scheduled date.
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const scope =
      user.role === "EXECUTIVE" ? executiveVisitScope(user.userId) : {};

    const carried = await prisma.subtask.findMany({
      where: {
        isCarriedForward: true,
        task: { visit: scope },
      },
      select: {
        id: true,
        title: true,
        isCompleted: true,
        task: {
          select: {
            title: true,
            taskType: true,
            visit: {
              select: {
                id: true,
                visitNumber: true,
                scheduledDate: true,
                status: true,
                // clientId is what the popup groups on — client names are not
                // unique (duplicated clients share a base name).
                client: { select: { id: true, name: true, code: true } },
                executive: { select: { id: true, name: true } },
              },
            },
          },
        },
        // Where the item originally came from.
        sourceSubtask: {
          select: {
            task: {
              select: {
                title: true,
                visit: { select: { visitNumber: true, scheduledDate: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const items = carried.map((s) => ({
      subtaskId: s.id,
      subtaskTitle: s.title.replace("[CARRY-FORWARD] ", ""),
      isCompleted: s.isCompleted,
      mainTask: s.task.title,
      taskType: s.task.taskType,
      clientId: s.task.visit.client.id,
      clientName: s.task.visit.client.name,
      clientCode: s.task.visit.client.code,
      executiveName: s.task.visit.executive.name,
      executiveId: s.task.visit.executive.id,
      visitId: s.task.visit.id,
      visitNumber: s.task.visit.visitNumber,
      visitStatus: s.task.visit.status,
      // The date this carry-forward is currently scheduled on, and where it
      // came from — both shown in the popup.
      currentScheduledDate: s.task.visit.scheduledDate,
      originalVisitNumber: s.sourceSubtask?.task.visit.visitNumber ?? null,
      originalDate: s.sourceSubtask?.task.visit.scheduledDate ?? null,
    }));

    return NextResponse.json({ carryForwards: items, total: items.length });
  } catch (error) {
    console.error("Executive carry-forward error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * A carry-forward-only visit exists purely to hold carried subtasks. Once its
 * last one is moved into a real client visit, the empty shell would otherwise
 * stay on the calendar, the dashboards and the visit lists, looking exactly
 * like the duplicate visit the reuse rule exists to prevent. Removing it is
 * safe precisely because it is CF-only and now holds nothing: no normal task,
 * no completion and no history of its own is lost, and the carried subtask
 * itself has already been re-parented to the destination visit.
 *
 * Visits that hold any real work — or that were never carry-forward-only —
 * are never touched.
 */
async function discardEmptiedCarryForwardHolder(visitId: string): Promise<boolean> {
  const v = await prisma.visit.findUnique({
    where: { id: visitId },
    select: {
      id: true, notes: true, status: true,
      tasks: { select: { id: true, subtasks: { select: { id: true } } } },
    },
  });
  if (!v) return false;
  if (v.status === "CLOSED") return false;
  if (!isSubtaskOnlyCarryForwardVisit(v)) return false;
  if (v.tasks.some((t) => t.subtasks.length > 0)) return false;

  await prisma.activityLog.deleteMany({ where: { visitId: v.id } });
  await prisma.visitReassignment.deleteMany({ where: { visitId: v.id } });
  await prisma.visitDelegation.deleteMany({ where: { visitId: v.id } });
  await prisma.visit.delete({ where: { id: v.id } }); // tasks cascade
  return true;
}

// ─── PATCH /api/carry-forward ────────────────────────────────────────────────
// Executive selects a new date for a carry-forward item (§6).
// Body: { subtaskId: string, date: string }
//
// The item moves to the client's EXISTING visit on that date when one exists
// (§8 — never create a duplicate); otherwise the visit holding it is
// rescheduled to the chosen date.
export async function PATCH(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({})) as { subtaskId?: string; date?: string };
    if (!body.subtaskId || !body.date) {
      return NextResponse.json({ error: "subtaskId and date are required" }, { status: 400 });
    }
    const newDate = new Date(body.date);
    if (isNaN(newDate.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const subtask = await prisma.subtask.findUnique({
      where: { id: body.subtaskId },
      include: {
        task: {
          include: {
            visit: {
              select: {
                id: true, clientId: true, executiveId: true, status: true, visitNumber: true,
                assignments: { select: { executiveId: true, role: true } },
              },
            },
          },
        },
      },
    });
    if (!subtask) return NextResponse.json({ error: "Carry-forward task not found" }, { status: 404 });
    if (!subtask.isCarriedForward) {
      return NextResponse.json({ error: "Only carry-forward tasks can be rescheduled here" }, { status: 400 });
    }
    if (subtask.isCompleted) {
      return NextResponse.json({ error: "This carry-forward task is already completed" }, { status: 400 });
    }

    const visit = subtask.task.visit;

    // Executives may only move their own (or their team's) carry-forward.
    if (user.role === "EXECUTIVE") {
      const onVisit =
        visit.executiveId === user.userId ||
        visit.assignments.some((a) => a.executiveId === user.userId);
      if (!onVisit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (visit.status === "CLOSED") {
      return NextResponse.json({ error: "Cannot reschedule a carry-forward task on a closed visit" }, { status: 400 });
    }

    const dayStart = toMidnightIST(newDate);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    // Already on the requested day → nothing to do. Without this, re-picking
    // the same date (or re-submitting the same selection) fell through to the
    // "split this item into its own visit" path below and moved the task OUT
    // of the visit it had just been attached to, creating an extra visit each
    // time. Repeating the action must be a no-op.
    const current = await prisma.visit.findUnique({
      where: { id: visit.id },
      select: { visitNumber: true, scheduledDate: true },
    });
    if (current && current.scheduledDate >= dayStart && current.scheduledDate < dayEnd) {
      return NextResponse.json({
        success: true,
        unchanged: true,
        movedToExistingVisit: false,
        visitId: visit.id,
        visitNumber: current.visitNumber,
        scheduledDate: current.scheduledDate,
      });
    }

    // Is there already a visit for this client on the chosen date that belongs
    // to the SAME executive this work is currently assigned to?
    //
    // The scope matters. Matching on client + date alone would move the item
    // into whatever visit happened to fall on that day — including another
    // executive's — which silently transfers the work out of this executive's
    // queue and modifies a visit nobody asked to touch. Re-dating may only
    // ever land on a visit the current holder already works, so the item stays
    // with them; if they have none on that day, the paths below give them one.
    const holderExecutiveId = visit.executiveId;
    const existing = await prisma.visit.findFirst({
      where: {
        clientId: visit.clientId,
        scheduledDate: { gte: dayStart, lt: dayEnd },
        status: { in: ["PENDING", "OPEN"] },
        id: { not: visit.id },
        OR: [
          { executiveId: holderExecutiveId },
          { assignments: { some: { executiveId: holderExecutiveId } } },
        ],
      },
      include: { tasks: true },
    });

    if (existing) {
      // Move the carried subtask into the existing visit's matching main task,
      // creating that task only if the visit does not have it yet.
      let target = existing.tasks.find((t) => t.taskType === subtask.task.taskType);
      if (!target) {
        const maxOrder = existing.tasks.reduce((m, t) => Math.max(m, t.orderIndex), -1);
        target = await prisma.task.create({
          data: {
            visitId: existing.id,
            taskType: subtask.task.taskType,
            title: subtask.task.title,
            status: "PENDING",
            orderIndex: maxOrder + 1,
          },
        });
      }
      await prisma.subtask.update({ where: { id: subtask.id }, data: { taskId: target.id } });
      await discardEmptiedCarryForwardHolder(visit.id);

      return NextResponse.json({
        success: true,
        movedToExistingVisit: true,
        visitId: existing.id,
        visitNumber: existing.visitNumber,
      });
    }

    // ── No visit on that date ────────────────────────────────────────────────
    // Rescheduling ONE carry-forward item must not move anybody else's work.
    // Moving the whole visit is only correct when the visit exists purely to
    // hold carried items; if it also holds the client's normal tasks (which is
    // exactly what §10's "add into the existing visit" produces), moving it
    // would silently drag those normal tasks to another date too.
    const holder = await prisma.visit.findUnique({
      where: { id: visit.id },
      select: {
        visitNumber: true,
        tasks: { select: { subtasks: { select: { id: true, isCarriedForward: true } } } },
      },
    });
    const allSubtasks = (holder?.tasks ?? []).flatMap((t) => t.subtasks);
    // Move the visit itself ONLY when it is a carry-forward holder whose sole
    // content is this very subtask. A holder carrying several items would
    // otherwise drag the other executives' items to the new date too, and a
    // mixed visit would drag the client's normal tasks — in both cases
    // rescheduling one task would silently reschedule work nobody asked to
    // move. Anything else splits just this subtask off below.
    const carriedOnly = allSubtasks.length === 1 && allSubtasks.every((s) => s.isCarriedForward);

    if (carriedOnly) {
      const updated = await prisma.visit.update({
        where: { id: visit.id },
        data: { scheduledDate: newDate, endDate: newDate },
        select: { id: true, visitNumber: true, scheduledDate: true },
      });
      return NextResponse.json({
        success: true,
        movedToExistingVisit: false,
        visitId: updated.id,
        visitNumber: updated.visitNumber,
        scheduledDate: updated.scheduledDate,
      });
    }

    // Mixed visit → give the carried item its own carry-forward-only visit on
    // the chosen date and move just that subtask into it. The source visit,
    // its normal tasks and their completion are untouched.
    const { visitId: newVisitId } = await createVisitForClient(
      visit.clientId,
      visit.executiveId,
      user.userId,
      {
        scheduledDate: newDate,
        endDate: newDate,
        notes: `${CARRY_FORWARD_NOTE_PREFIX} Rescheduled from ${holder?.visitNumber ?? visit.visitNumber}] ${CARRY_FORWARD_SUBTASKS_ONLY_MARKER}`,
        skipActiveDuplicateGuard: true,
        skipTaskScaffolding: true,
      }
    );
    const movedTask = await prisma.task.create({
      data: {
        visitId: newVisitId,
        taskType: subtask.task.taskType,
        title: subtask.task.title,
        status: "PENDING",
        orderIndex: 0,
      },
    });
    await prisma.subtask.update({ where: { id: subtask.id }, data: { taskId: movedTask.id } });
    // The holder this item just left may now be empty — never leave the shell.
    await discardEmptiedCarryForwardHolder(visit.id);
    // If discarding it left this new visit as the client's only one for the
    // week, it is no longer a supplement to a real visit — it IS the client's
    // visit, so it needs their configured tasks too. Declines by itself while
    // another visit still covers that week, which is the normal case here.
    await ensureCarryForwardVisitHasClientTasks(newVisitId);
    const created = await prisma.visit.findUnique({
      where: { id: newVisitId },
      select: { id: true, visitNumber: true, scheduledDate: true },
    });

    return NextResponse.json({
      success: true,
      movedToExistingVisit: false,
      visitId: created!.id,
      visitNumber: created!.visitNumber,
      scheduledDate: created!.scheduledDate,
    });
  } catch (error) {
    console.error("Executive carry-forward reschedule error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
