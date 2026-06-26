import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/middleware";
import { getSubtaskTotals } from "@/lib/utils/visit-status";

// ─── GET /api/admin/stats ──────────────────────────────────────────────────────
// Optimized: single DB query, carry-forward computed from in-memory data
// (avoids the extra prisma.subtask.count round-trip)

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "ADMIN")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    // Single query — fetch only what we need (no full task bodies, just status fields)
    const allVisits = await prisma.visit.findMany({
      select: {
        id:            true,
        visitNumber:   true,
        status:        true,
        scheduledDate: true,
        openedAt:      true,
        closedAt:      true,
        client: {
          select: { id: true, name: true, code: true },
        },
        executive: {
          select: { id: true, name: true, email: true },
        },
        tasks: {
          select: {
            subtasks: {
              select: { isCompleted: true, isCarriedForward: true },
            },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    let totalCarryForward = 0;
    const withProgress = allVisits.map((v: any) => {
      const { totalSubtasks, completedSubtasks, carryForwardCount, progress, displayStatus } =
        getSubtaskTotals(v.tasks);

      // Accumulate carry-forward count in the same pass — no extra DB query
      totalCarryForward += carryForwardCount;

      return {
        id:               v.id,
        visitNumber:      v.visitNumber,
        client:           v.client,
        executive:        v.executive,
        status:           v.status,
        displayStatus,
        scheduledDate:    v.scheduledDate,
        openedAt:         v.openedAt,
        closedAt:         v.closedAt,
        progress,
        totalSubtasks,
        completedSubtasks,
        carryForwardCount,
      };
    });

    const pendingVisits    = withProgress.filter((v) => v.displayStatus === "PENDING");
    const inProgressVisits = withProgress.filter((v) => v.displayStatus === "IN_PROGRESS");
    const closedVisits     = withProgress.filter((v) => v.displayStatus === "CLOSED");

    return NextResponse.json({
      summary: {
        total:           allVisits.length,
        pendingCount:    pendingVisits.length,
        inProgressCount: inProgressVisits.length,
        closedCount:     closedVisits.length,
        carryForwardCount: totalCarryForward,
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
