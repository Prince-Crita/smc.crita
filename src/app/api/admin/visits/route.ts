import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { isAdminRole } from "@/lib/auth/roles";
import { prisma } from "@/lib/db/prisma";
import { getSubtaskTotals, sortVisitsForDisplay } from "@/lib/utils/visit-status";
import { getApprovedLeave } from "@/lib/utils/leave-check";
import { isCarryForwardVisit } from "@/lib/utils/carry-forward";
import { resolveClientTaskPlan, createTasksWithSubtasks } from "@/lib/utils/create-visit";


// GET /api/admin/visits - All visits with filters
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");
    const executiveId = searchParams.get("executiveId");
    // NOTE: "status" filter param now maps to displayStatus (PENDING / IN_PROGRESS / CLOSED)
    // not to the raw DB visit.status field - we filter in-memory after progress calculation
    const displayStatusFilter = searchParams.get("status");

    // ?meta=1 → only the client + executive dropdown options. The admin
    // Calendar page needs nothing else from this endpoint, and was otherwise
    // pulling EVERY visit with all of its tasks and subtasks on each load
    // purely to populate two <select>s.
    if (searchParams.get("meta") === "1") {
      const [clients, executives] = await Promise.all([
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
      return NextResponse.json({ visits: [], clients, executives, stats: { total: 0, pending: 0, inProgress: 0, closed: 0 } });
    }

    const where: Record<string, unknown> = {};
    if (clientId) where.clientId = clientId;
    if (executiveId) where.executiveId = executiveId;
    // Do NOT apply status filter to DB query - DB status != display status

    const [allVisits, clients, executives] = await Promise.all([
      prisma.visit.findMany({
        where,
        select: {
          id:             true,
          visitNumber:    true,
          status:         true,
          scheduledDate:  true,
          openedAt:       true,
          closedAt:       true,
          executiveId:    true,
          notes:          true,
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
    const visitsWithProgress = allVisits.map((visit: any) => {
      const { totalSubtasks, completedSubtasks, carryForwardCount, progress, displayStatus } =
        getSubtaskTotals(visit.tasks, visit.status);
      // Carry-forward can originate from subtask-level carries (Business
      // Rule 1) OR an auto-created "missed weekly visit" (Business Rule 2,
      // flagged via the notes marker) — shared helper, single source of truth.
      const hasCarryForward = carryForwardCount > 0 || isCarryForwardVisit(visit);
      return {
        ...visit,
        progress,
        totalSubtasks,
        completedSubtasks,
        carryForwardCount,
        hasCarryForward,
        displayStatus, // progress-based - use this for all UI display
        // dbStatus kept for internal workflow purposes (open/close actions)
        dbStatus: visit.status,
      };
    });

    // Apply display-status filter in memory (after progress calculation),
    // then the canonical display order: pending soonest-first, in-progress and
    // closed most-recent-first.
    const visits = sortVisitsForDisplay(
      displayStatusFilter
        ? visitsWithProgress.filter((v: any) => v.displayStatus === displayStatusFilter)
        : visitsWithProgress
    );

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

// --- POST /api/admin/visits -- Create a new visit ------------------------------
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json() as {
      clientId: string;
      executiveId: string;
      scheduledDate: string;
      endDate?: string;
      notes?: string;
    };

    const { clientId, executiveId, scheduledDate, endDate, notes } = body;

    if (!clientId || !executiveId || !scheduledDate) {
      return NextResponse.json({ error: "clientId, executiveId, and scheduledDate are required" }, { status: 400 });
    }

    const scheduledAt = new Date(scheduledDate);
    if (isNaN(scheduledAt.getTime())) {
      return NextResponse.json({ error: "Invalid scheduledDate" }, { status: 400 });
    }

    let endAt: Date | null = null;
    if (endDate) {
      endAt = new Date(endDate);
      if (isNaN(endAt.getTime())) {
        return NextResponse.json({ error: "Invalid endDate" }, { status: 400 });
      }
      if (endAt < scheduledAt) {
        return NextResponse.json({ error: "End date cannot be before the start date" }, { status: 400 });
      }
    }

    // Leave conflict check
    const leaveConflict = await getApprovedLeave(executiveId, scheduledAt);
    if (leaveConflict) {
      return NextResponse.json(
        {
          error: "Executive is on approved leave on this date. Please select another date or another executive.",
          code: "LEAVE_CONFLICT",
        },
        { status: 409 }
      );
    }

    // Generate visit number
    const visitCount = await prisma.visit.count();
    const visitNumber = `V${String(visitCount + 1).padStart(4, "0")}`;

    const visit = await prisma.visit.create({
      data: {
        visitNumber,
        clientId,
        executiveId,
        scheduledDate: scheduledAt,
        endDate: endAt,
        notes: notes?.trim() || null,
        status: "PENDING",
      },
      include: {
        client: { select: { name: true, code: true } },
        executive: { select: { name: true, email: true } },
      },
    });

    // Repeated-client auto population: scaffold the client's CURRENT task
    // configuration (main tasks + subtasks, client-specific > global) so the
    // admin never has to recreate tasks for a returning client. Previously
    // this route created a visit with ZERO tasks. Any due carry-forward from
    // the client's earlier visits flows into this visit automatically via
    // the carry-forward sweep (same-client only).
    const plan = await resolveClientTaskPlan(clientId);
    await createTasksWithSubtasks(visit.id, plan);

    await prisma.activityLog.create({
      data: {
        visitId: visit.id,
        userId: user.userId,
        action: "VISIT_CREATED",
        metadata: { visitNumber, by: user.name },
      },
    });

    return NextResponse.json({ visit }, { status: 201 });
  } catch (error) {
    console.error("Create visit error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
