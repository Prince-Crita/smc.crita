import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { prisma } from "@/lib/db/prisma";
import { getSubtaskTotals } from "@/lib/utils/visit-status";

// GET /api/admin/visits - All visits with filters
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");
    const executiveId = searchParams.get("executiveId");
    // NOTE: "status" filter param now maps to displayStatus (PENDING / IN_PROGRESS / CLOSED)
    // not to the raw DB visit.status field — we filter in-memory after progress calculation
    const displayStatusFilter = searchParams.get("status");

    const where: Record<string, unknown> = {};
    if (clientId) where.clientId = clientId;
    if (executiveId) where.executiveId = executiveId;
    // Do NOT apply status filter to DB query — DB status ≠ display status

    const [allVisits, clients, executives] = await Promise.all([
      prisma.visit.findMany({
        where,
        select: {
          id:             true,
          visitNumber:    true,
          status:         true,
          scheduledDate:  true,
          closedAt:       true,
          executiveId:    true,
          client:    { select: { id: true, name: true, code: true } },
          executive: { select: { id: true, name: true } },
          tasks: {
            select: {
              subtasks: {
                // Only the two boolean fields needed for progress calculation
                select: { isCompleted: true, isCarriedForward: true },
              },
            },
          },
        },
        orderBy: { scheduledDate: "desc" },
      }),
      prisma.client.findMany({
        select: { id: true, name: true, code: true },
        orderBy: { name: "asc" },
      }),
      prisma.user.findMany({
        where: { role: "EXECUTIVE" },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);

    // Compute progress-based displayStatus for every visit using shared utility
    const visitsWithProgress = allVisits.map((visit) => {
      const { totalSubtasks, completedSubtasks, carryForwardCount, progress, displayStatus } =
        getSubtaskTotals(visit.tasks);
      return {
        ...visit,
        progress,
        totalSubtasks,
        completedSubtasks,
        carryForwardCount,
        displayStatus, // progress-based — use this for all UI display
        // dbStatus kept for internal workflow purposes (open/close actions)
        dbStatus: visit.status,
      };
    });

    // Apply display-status filter in memory (after progress calculation)
    const visits =
      displayStatusFilter
        ? visitsWithProgress.filter((v) => v.displayStatus === displayStatusFilter)
        : visitsWithProgress;

    // Stats based on displayStatus (progress), NOT raw DB status
    const stats = {
      total: visitsWithProgress.length,
      pending: visitsWithProgress.filter((v) => v.displayStatus === "PENDING").length,
      inProgress: visitsWithProgress.filter((v) => v.displayStatus === "IN_PROGRESS").length,
      closed: visitsWithProgress.filter((v) => v.displayStatus === "CLOSED").length,
    };

    return NextResponse.json({ visits, clients, executives, stats });
  } catch (error) {
    console.error("Admin visits error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
