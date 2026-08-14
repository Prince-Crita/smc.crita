import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getAuthUser } from "@/lib/auth/middleware";
import { prisma } from "@/lib/db/prisma";
import { getSubtaskTotals, sortVisitsForDisplay } from "@/lib/utils/visit-status";
import { isCarryForwardVisit } from "@/lib/utils/carry-forward";
import { executiveVisitScope } from "@/lib/utils/visit-access";

// --- GET /api/visits -------------------------------------------------------------
// Executive gets their assigned visits.
// Optimized: select only required fields (no subtask IDs, no task content)

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const displayStatusFilter = searchParams.get("status");

    // Executives see the visits they own (solo executive or team lead) AND the
    // team visits they are a member of.
    const where: Prisma.VisitWhereInput = {};
    if (user.role === "EXECUTIVE") {
      Object.assign(where, executiveVisitScope(user.userId));
    }

    const visits = await prisma.visit.findMany({
      where,
      select: {
        id:            true,
        visitNumber:   true,
        status:        true,
        visitType:     true,
        executiveId:   true,
        scheduledDate: true,
        endDate:       true,
        openedAt:      true,
        closedAt:      true,
        notes:         true,
        client: {
          select: { name: true, code: true, contactPerson: true },
        },
        executive: {
          select: { name: true, email: true },
        },
        assignments: {
          select: { executiveId: true, role: true, executive: { select: { name: true } } },
        },
        tasks: {
          select: {
            subtasks: {
              // Only the boolean fields we need - no IDs or text
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
        getSubtaskTotals(visit.tasks, visit.status);
      // Carry-forward can originate from subtask-level carries (Business
      // Rule 1) OR an auto-created "missed weekly visit" (Business Rule 2,
      // flagged via the notes marker) — shared helper, single source of truth.
      const hasCarryForward = carryForwardCount > 0 || isCarryForwardVisit(visit);
      // Team shape for the UI: the lead is Visit.executiveId, members are the
      // non-LEAD assignment rows. `canClose` is what the executive's own view
      // uses to decide whether to offer the Close button — a team member
      // never gets it (the API enforces the same rule server-side).
      const isLead = visit.executiveId === user.userId;
      return {
        ...visit,
        progress,
        totalSubtasks,
        completedSubtasks,
        carryForwardCount,
        hasCarryForward,
        displayStatus,
        isTeamVisit: visit.visitType === "TEAM",
        teamRole: isLead ? "LEAD" : "MEMBER",
        canClose: isLead,
        teamMembers: visit.assignments
          .filter((a) => a.role !== "LEAD")
          .map((a) => ({ id: a.executiveId, name: a.executive.name })),
      };
    });

    // Apply display-status filter in memory (avoids second DB query)
    const filtered = displayStatusFilter
      ? visitsWithProgress.filter((v) => v.displayStatus === displayStatusFilter)
      : visitsWithProgress;

    // Canonical display order: pending soonest-first, in-progress and closed
    // most-recent-first. The raw `scheduledDate desc` from the query put the
    // 31st before the 16th in the executive's Pending list.
    return NextResponse.json({ visits: sortVisitsForDisplay(filtered) });
  } catch (error) {
    console.error("Get visits error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
