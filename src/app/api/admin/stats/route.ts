import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/middleware";
import { isAdminRole } from "@/lib/auth/roles";
import { getVisitSubtaskCounts, totalsForVisit } from "@/lib/utils/visit-aggregates";
import { runCarryForwardMaintenance, isCarryForwardVisit } from "@/lib/utils/carry-forward";
import { toMidnightIST } from "@/lib/utils/attendance";

// --- GET /api/admin/stats ------------------------------------------------------
// Optimized: single DB query, carry-forward + overdue computed from in-memory data

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    // Lazy, throttled, idempotent carry-forward maintenance (missed-weekly
    // visits + end-date-due carry-forwards) — see carry-forward.ts.
    await runCarryForwardMaintenance();

    const now = new Date();

    // ── Today's IST calendar-day window ───────────────────────────────────
    // Everything in the `today` block below is computed strictly inside
    // [todayStart, todayEnd) — the business day the admin is looking at.
    // Attendance/leave already key off IST midnight (see attendance.ts), so
    // the same boundary is reused here for a single consistent "today".
    const todayStart = toMidnightIST(now);
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    const [allVisits, todayLeaveCount, counts, mdMeetingNoTasks] = await Promise.all([
      prisma.visit.findMany({
        select: {
          id:            true,
          visitNumber:   true,
          status:        true,
          scheduledDate: true,
          endDate:       true,
          openedAt:      true,
          closedAt:      true,
          notes:         true,
          client:    { select: { id: true, name: true, code: true } },
          executive: { select: { id: true, name: true, email: true } },
        },
        orderBy: { updatedAt: "desc" },
      }),
      // Leave requests RAISED today that still await an admin decision.
      // (LeaveRequest.date is always a future date — the executive leave form
      // enforces min = tomorrow — so "today's leave requests" can only mean
      // the ones submitted today.)
      prisma.leaveRequest.count({
        where: { status: "PENDING", createdAt: { gte: todayStart, lt: todayEnd } },
      }),
      // Per-visit subtask counts, aggregated in the database instead of
      // materialising every subtask row of every visit (visit-aggregates.ts).
      getVisitSubtaskCounts(),
      // The only task-level fact this endpoint needs: which visits answered
      // "NO" to the MD meeting. A handful of rows, instead of the whole task
      // table travelling along with the subtasks.
      prisma.task.findMany({
        where: { taskType: "MD_MEETING", mdMeetingAnswer: "NO" },
        select: { visitId: true },
      }),
    ]);

    const mdMeetingNoVisitIds = new Set(mdMeetingNoTasks.map((t) => t.visitId));

    let totalCarryForward = 0;
    // Reuses the exact "[Rescheduled:" marker convention written by
    // POST /api/visits/[visitId]/reschedule — no separate rescheduledAt column exists.
    let rescheduledCount = 0;
    // Visits closed with MD Meeting = NO (admin must be notified - P6)
    let mdMeetingNoCount = 0;

    const withProgress = allVisits.map((v) => {
      const { totalSubtasks, completedSubtasks, carryForwardCount, progress, displayStatus } =
        totalsForVisit(counts, v.id, v.status);

      // Carry-forward can originate from subtask-level carries (Business
      // Rule 1) OR an auto-created "missed weekly visit" (Business Rule 2,
      // flagged via the notes marker). Count visit-level-only carries (no
      // carried subtasks yet) as 1 occurrence so the aggregate stat
      // doesn't silently ignore them.
      const hasCarryForward = carryForwardCount > 0 || isCarryForwardVisit(v);
      totalCarryForward += carryForwardCount > 0 ? carryForwardCount : hasCarryForward ? 1 : 0;

      if (v.notes && v.notes.includes("[Rescheduled:")) {
        rescheduledCount += 1;
      }

      // Closed without the MD meeting having been held
      const mdMeetingNo = v.status === "CLOSED" && mdMeetingNoVisitIds.has(v.id);
      if (mdMeetingNo) mdMeetingNoCount += 1;

      // Overdue = scheduled date is past today AND visit is not closed
      const isOverdue =
        new Date(v.scheduledDate) < now && displayStatus !== "CLOSED";

      // ── "Is this today's visit?" ──────────────────────────────────────
      // A visit occupies the window [scheduledDate .. endDate] (endDate is
      // optional and defaults to the scheduled day itself — see the Visit
      // model doc). It belongs to TODAY when that window overlaps today's
      // IST calendar day, which is exactly the rule the calendar and the
      // executive's visit list already work by.
      const startsAt = new Date(v.scheduledDate);
      const endsAt = v.endDate ? new Date(v.endDate) : startsAt;
      const isToday = startsAt < todayEnd && endsAt >= todayStart;

      return {
        id: v.id,
        visitNumber: v.visitNumber,
        client: v.client,
        executive: v.executive,
        status: v.status,
        displayStatus,
        scheduledDate: v.scheduledDate,
        openedAt: v.openedAt,
        closedAt: v.closedAt,
        progress,
        totalSubtasks,
        completedSubtasks,
        carryForwardCount,
        hasCarryForward,
        isOverdue,
        isToday,
        mdMeetingNo,
      };
    });

    const pendingVisits    = withProgress.filter((v) => v.displayStatus === "PENDING");
    const inProgressVisits = withProgress.filter((v) => v.displayStatus === "IN_PROGRESS");
    const closedVisits     = withProgress.filter((v) => v.displayStatus === "CLOSED");
    // Counted, not returned: the three arrays above already partition every
    // visit, so an `overdueVisits` array was a fourth, redundant copy of rows
    // the dashboard never read — roughly a third of this response's size.
    const overdueCount     = withProgress.reduce((n, v) => n + (v.isOverdue ? 1 : 0), 0);

    // ── TODAY-ONLY counters (drive the "Today's Alerts" panel) ────────────
    // SINGLE BASIS: `isToday`, i.e. the visit's SCHEDULED window overlaps
    // today's IST calendar day. Every counter below is a filter over that one
    // set, so no visit from a previous or future date can reach the panel
    // through any counter, and the parts always add up to the whole:
    //   total === pending + inProgress + completed
    // (displayStatus is exhaustive over those three).
    const todayVisits = withProgress.filter((v) => v.isToday);
    const todaySummary = {
      total:             todayVisits.length,
      pendingCount:      todayVisits.filter((v) => v.displayStatus === "PENDING").length,
      inProgressCount:   todayVisits.filter((v) => v.displayStatus === "IN_PROGRESS").length,
      // Completed = a visit SCHEDULED for today that is now closed. Deliberately
      // NOT "closedAt falls inside today": a visit scheduled last week but closed
      // this morning is not one of today's visits and must not appear here.
      completedCount:    todayVisits.filter((v) => v.displayStatus === "CLOSED").length,
      // Missed = scheduled for today, past its scheduled start, still not closed
      // — the same overdue rule used everywhere else, scoped to today.
      missedCount:       todayVisits.filter((v) => v.isOverdue).length,
      carryForwardCount: todayVisits.reduce(
        (s, v) => s + (v.carryForwardCount > 0 ? v.carryForwardCount : v.hasCarryForward ? 1 : 0),
        0
      ),
      mdMeetingNoCount:  todayVisits.filter((v) => v.mdMeetingNo).length,
      leaveRequestCount: todayLeaveCount,
    };

    return NextResponse.json({
      today: todaySummary,
      summary: {
        total:             allVisits.length,
        pendingCount:      pendingVisits.length,
        inProgressCount:   inProgressVisits.length,
        closedCount:       closedVisits.length,
        missedCount:       overdueCount,
        carryForwardCount: totalCarryForward,
        rescheduledCount,
        mdMeetingNoCount,
        completionRate:
          allVisits.length > 0
            ? Math.round((closedVisits.length / allVisits.length) * 100)
            : 0,
      },
      pendingVisits,
      inProgressVisits,
      closedVisits,
    });
  } catch (error) {
    console.error("Admin stats error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
