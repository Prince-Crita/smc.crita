import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { prisma } from "@/lib/db/prisma";
import { getSubtaskTotals } from "@/lib/utils/visit-status";
import { runCarryForwardMaintenance, isCarryForwardVisit } from "@/lib/utils/carry-forward";
import { executiveVisitScope } from "@/lib/utils/visit-access";

// --- GET /api/calendar --------------------------------------------------------
// Query params:
//   week=YYYY-MM-DD  (any day in the desired week; defaults to current week)
//   executiveId=...  (admin only - filter by executive)
//
// Returns visits grouped by day-of-week (Mon-Sun) for that week.
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
    const visits = await prisma.visit.findMany({
      where: {
        scheduledDate: { gte: monday, lte: sunday },
        ...(executiveFilter ? executiveVisitScope(executiveFilter) : {}),
      },
      select: {
        id: true,
        visitNumber: true,
        status: true,
        scheduledDate: true,
        notes: true,
        client: { select: { name: true, code: true } },
        executive: { select: { id: true, name: true } },
        tasks: {
          select: {
            subtasks: { select: { isCompleted: true, isCarriedForward: true } },
          },
        },
      },
      orderBy: { scheduledDate: "asc" },
    });

    // Enrich with progress + carry-forward flag
    const enriched = visits.map((v) => {
      const { totalSubtasks, completedSubtasks, carryForwardCount, progress, displayStatus } =
        getSubtaskTotals(v.tasks, v.status);
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
