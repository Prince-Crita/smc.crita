import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getAuthUser } from "@/lib/auth/middleware";
import { prisma } from "@/lib/db/prisma";
import { getVisitSubtaskCounts, totalsForVisit } from "@/lib/utils/visit-aggregates";
import { runCarryForwardMaintenance, isCarryForwardVisit } from "@/lib/utils/carry-forward";
import { executiveVisitScope } from "@/lib/utils/visit-access";
import { getSubtaskTotals } from "@/lib/utils/visit-status";

// --- GET /api/calendar --------------------------------------------------------
// Query params:
//   week=YYYY-MM-DD  (any day in the desired week; defaults to current week)
//   executiveId=...  (admin only - filter by executive)
//   view=tasks       (optional - the week's Task History instead of the grid)
//
// Returns visits grouped by day-of-week (Mon-Sun) for that week.
//
// view=tasks returns the SAME visits — same week window, same executive scope
// — with their tasks and subtasks, for the Calendar → Task History view. One
// visit selection for both views keeps them in agreement: the history never
// lists a visit the grid does not show, or misses one it does.
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Lazy, throttled, idempotent check for missed-weekly-visit carry-forwards
    // (Business Rule 2) — cheap no-op most of the time (see comments in
    // carry-forward.ts for the throttle rationale).
    await runCarryForwardMaintenance();

    const { searchParams } = new URL(request.url);
    const weekParam = searchParams.get("week");
    const execIdParam = searchParams.get("executiveId");

    // Compute Monday of the target week
    const anchor = weekParam ? new Date(weekParam) : new Date();
    const dow = anchor.getUTCDay(); // 0=Sun
    const diffToMon = (dow === 0 ? -6 : 1 - dow);
    const monday = new Date(anchor);
    monday.setUTCDate(monday.getUTCDate() + diffToMon);
    monday.setUTCHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setUTCDate(sunday.getUTCDate() + 6);
    sunday.setUTCHours(23, 59, 59, 999);

    // Determine which executiveId(s) to fetch for
    const executiveFilter =
      user.role === "EXECUTIVE"
        ? user.userId
        : execIdParam || undefined; // admin: filter if provided, else all

    // An executive's own calendar includes the team visits they are a member
    // of, not just the ones they own. An admin filtering BY an executive uses
    // the same rule, so the admin sees what that executive sees.
    const where: Prisma.VisitWhereInput = {
      scheduledDate: { gte: monday, lte: sunday },
      ...(executiveFilter ? executiveVisitScope(executiveFilter) : {}),
    };

    // Week-wise Task History — same visits, task-level detail.
    if (searchParams.get("view") === "tasks") {
      return NextResponse.json(await buildWeekTaskHistory(where, monday, sunday));
    }

    const visits = await prisma.visit.findMany({
      where,
      select: {
        id: true,
        visitNumber: true,
        status: true,
        scheduledDate: true,
        notes: true,
        client: { select: { name: true, code: true } },
        executive: { select: { id: true, name: true } },
      },
      orderBy: { scheduledDate: "asc" },
    });

    // Progress for this week's visits, counted in the database (one row per
    // visit) rather than by loading each visit's whole subtask list.
    const counts = await getVisitSubtaskCounts(visits.map((v) => v.id));

    // Enrich with progress + carry-forward flag
    const enriched = visits.map((v) => {
      const { totalSubtasks, completedSubtasks, carryForwardCount, progress, displayStatus } =
        totalsForVisit(counts, v.id, v.status);
      return {
        id: v.id,
        visitNumber: v.visitNumber,
        status: v.status,
        displayStatus,
        scheduledDate: v.scheduledDate,
        notes: v.notes,
        client: v.client,
        executive: v.executive,
        progress,
        totalSubtasks,
        completedSubtasks,
        // Carry-forward can originate from either subtask-level carries
        // (Business Rule 1) OR an auto-created "missed weekly visit"
        // (Business Rule 2, flagged via the notes marker) — a visit is
        // "carry-forward" if EITHER is true.
        hasCarryForward: carryForwardCount > 0 || isCarryForwardVisit(v),
      };
    });

    // Group by ISO day (0=Mon ... 6=Sun) in the week
    const byDay: Record<number, typeof enriched> = {};
    for (let i = 0; i < 7; i++) byDay[i] = [];

    for (const v of enriched) {
      const d = new Date(v.scheduledDate);
      const dayOfWeek = d.getUTCDay(); // 0=Sun, 1=Mon...
      const idx = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // remap to 0=Mon ... 6=Sun
      byDay[idx].push(v);
    }

    // Build day metadata for the week
    const days = Array.from({ length: 7 }, (_, i) => {
      const day = new Date(monday);
      day.setUTCDate(day.getUTCDate() + i);
      return {
        index: i,
        date: day.toISOString(),
        dayLabel: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i],
        dayNumber: day.getUTCDate(),
        visits: byDay[i],
      };
    });

    // Week label
    const weekNumber = getWeekNumber(monday);
    const monthLabel = monday.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

    return NextResponse.json({ weekNumber, monthLabel, monday: monday.toISOString(), days });
  } catch (error) {
    console.error("Calendar GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function getWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

// ─── Week-wise Task History ───────────────────────────────────────────────────
// Read-only. Every value comes straight from the visit, task and subtask rows
// the executive works on — nothing here is derived from a separate history
// store, so it can never disagree with the visit pages.

/**
 * A task's state for the history list, from its subtasks — the same counts
 * the progress bars use. A task with no subtasks (nothing to tick) keeps the
 * status stored on it.
 */
function historyTaskStatus(
  completed: number,
  total: number,
  storedStatus: string,
  visitClosed: boolean
): string {
  if (total === 0) return storedStatus;
  if (completed === total) return "COMPLETED";
  if (completed > 0) return visitClosed ? "PARTIALLY_COMPLETED" : "IN_PROGRESS";
  return "PENDING";
}

async function buildWeekTaskHistory(where: Prisma.VisitWhereInput, monday: Date, sunday: Date) {
  const visits = await prisma.visit.findMany({
    where,
    select: {
      id: true,
      visitNumber: true,
      status: true,
      visitType: true,
      scheduledDate: true,
      endDate: true,
      closedAt: true,
      notes: true,
      client: { select: { name: true, code: true } },
      executive: { select: { id: true, name: true } },
      assignments: {
        select: { executiveId: true, role: true, executive: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      },
      tasks: {
        orderBy: { orderIndex: "asc" },
        select: {
          id: true,
          taskType: true,
          title: true,
          status: true,
          mdMeetingAnswer: true,
          completedAt: true,
          subtasks: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              title: true,
              isCompleted: true,
              completedAt: true,
              isCarriedForward: true,
              incompletionReason: true,
              carryForwardRequestedAt: true,
              carryForwardApprovedAt: true,
              carryForwardRejectedAt: true,
            },
          },
        },
      },
    },
    orderBy: { scheduledDate: "asc" },
  });

  const totals = { visits: visits.length, tasks: 0, completedTasks: 0, subtasks: 0, completedSubtasks: 0 };

  const rows = visits.map((v) => {
    const { carryForwardCount, displayStatus } = getSubtaskTotals(v.tasks, v.status);
    const visitClosed = v.status === "CLOSED";

    const tasks = v.tasks.map((t) => {
      const totalSubtasks = t.subtasks.length;
      const completedSubtasks = t.subtasks.filter((s) => s.isCompleted).length;
      const status = historyTaskStatus(completedSubtasks, totalSubtasks, t.status, visitClosed);

      totals.tasks += 1;
      if (status === "COMPLETED") totals.completedTasks += 1;
      totals.subtasks += totalSubtasks;
      totals.completedSubtasks += completedSubtasks;

      return {
        id: t.id,
        taskType: t.taskType,
        title: t.title,
        status,
        mdMeetingAnswer: t.mdMeetingAnswer,
        completedAt: t.completedAt,
        completedSubtasks,
        totalSubtasks,
        subtasks: t.subtasks.map((s) => ({
          id: s.id,
          title: s.title.replace("[CARRY-FORWARD] ", ""),
          isCompleted: s.isCompleted,
          completedAt: s.completedAt,
          isCarriedForward: s.isCarriedForward,
          incompletionReason: s.incompletionReason,
          // Where an unfinished item stands in the admin-approved
          // carry-forward workflow (approval clears any earlier rejection).
          carryForward: s.carryForwardApprovedAt
            ? "APPROVED"
            : s.carryForwardRejectedAt
            ? "REJECTED"
            : s.carryForwardRequestedAt
            ? "REQUESTED"
            : null,
        })),
      };
    });

    return {
      id: v.id,
      visitNumber: v.visitNumber,
      status: v.status,
      displayStatus,
      visitType: v.visitType,
      scheduledDate: v.scheduledDate,
      endDate: v.endDate,
      closedAt: v.closedAt,
      hasCarryForward: carryForwardCount > 0 || isCarryForwardVisit(v),
      client: v.client,
      // The lead is Visit.executiveId; members are the non-LEAD team rows.
      lead: { id: v.executive.id, name: v.executive.name },
      members: v.assignments
        .filter((a) => a.role !== "LEAD")
        .map((a) => ({ id: a.executiveId, name: a.executive.name })),
      tasks,
    };
  });

  return {
    weekNumber: getWeekNumber(monday),
    monday: monday.toISOString(),
    sunday: sunday.toISOString(),
    visits: rows,
    totals,
  };
}
