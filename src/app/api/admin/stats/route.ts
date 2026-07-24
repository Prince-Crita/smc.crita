import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/middleware";
import { isAdminRole } from "@/lib/auth/roles";
import { getSubtaskTotals } from "@/lib/utils/visit-status";
import { runCarryForwardMaintenance, isCarryForwardVisit } from "@/lib/utils/carry-forward";

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

    const allVisits = await prisma.visit.findMany({
      select: {
        id:            true,
        visitNumber:   true,
        status:        true,
        scheduledDate: true,
        openedAt:      true,
        closedAt:      true,
        notes:         true,
        client:    { select: { id: true, name: true, code: true } },
        executive: { select: { id: true, name: true, email: true } },
        tasks: {
          select: {
            taskType: true,
            mdMeetingAnswer: true,
            subtasks: { select: { isCompleted: true, isCarriedForward: true } },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    let totalCarryForward = 0;
    // Reuses the exact "[Rescheduled:" marker convention written by
    // POST /api/visits/[visitId]/reschedule — no separate rescheduledAt column exists.
    let rescheduledCount = 0;
    // Visits closed with MD Meeting = NO (admin must be notified - P6)
    let mdMeetingNoCount = 0;

    const withProgress = allVisits.map((v: any) => {
      const { totalSubtasks, completedSubtasks, carryForwardCount, progress, displayStatus } =
        getSubtaskTotals(v.tasks, v.status);

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
      const mdMeetingNo =
        v.status === "CLOSED" &&
        v.tasks.some((t: any) => t.taskType === "MD_MEETING" && t.mdMeetingAnswer === "NO");
      if (mdMeetingNo) mdMeetingNoCount += 1;

      // Overdue = scheduled date is past today AND visit is not closed
      const isOverdue =
        new Date(v.scheduledDate) < now && displayStatus !== "CLOSED";

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
      };
    });

    const pendingVisits    = withProgress.filter((v) => v.displayStatus === "PENDING");
    const inProgressVisits = withProgress.filter((v) => v.displayStatus === "IN_PROGRESS");
    const closedVisits     = withProgress.filter((v) => v.displayStatus === "CLOSED");
    const overdueVisits    = withProgress.filter((v) => v.isOverdue);

    return NextResponse.json({
      summary: {
        total:             allVisits.length,
        pendingCount:      pendingVisits.length,
        inProgressCount:   inProgressVisits.length,
        closedCount:       closedVisits.length,
        missedCount:       overdueVisits.length,
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
      overdueVisits,
    });
  } catch (error) {
    console.error("Admin stats error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
