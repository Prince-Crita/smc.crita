import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { prisma } from "@/lib/db/prisma";
import { getSubtaskTotals } from "@/lib/utils/visit-status";

// ─── GET /api/visits ───────────────────────────────────────────────────────────
// Executive gets their assigned visits.
// Optimized: select only required fields (no subtask IDs, no task content)

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const displayStatusFilter = searchParams.get("status");

    const where: Record<string, unknown> = {};
    if (user.role === "EXECUTIVE") {
      where.executiveId = user.userId;
    }

    const visits = await prisma.visit.findMany({
      where,
      select: {
        id:            true,
        visitNumber:   true,
        status:        true,
        scheduledDate: true,
        client: {
          select: { name: true, code: true, contactPerson: true },
        },
        executive: {
          select: { name: true, email: true },
        },
        tasks: {
          select: {
            subtasks: {
              // Only the boolean fields we need — no IDs or text
              select: { isCompleted: true, isCarriedForward: true },
            },
          },
        },
      },
      orderBy: { scheduledDate: "desc" },
    });

    // Compute progress-based displayStatus using shared utility
    const visitsWithProgress = visits.map((visit) => {
      const { totalSubtasks, completedSubtasks, carryForwardCount, progress, displayStatus } =
        getSubtaskTotals(visit.tasks);
      return {
        ...visit,
        progress,
        totalSubtasks,
        completedSubtasks,
        carryForwardCount,
        displayStatus,
      };
    });

    // Apply display-status filter in memory (avoids second DB query)
    const filtered = displayStatusFilter
      ? visitsWithProgress.filter((v) => v.displayStatus === displayStatusFilter)
      : visitsWithProgress;

    return NextResponse.json({ visits: filtered });
  } catch (error) {
    console.error("Get visits error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
