import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { isAdminRole } from "@/lib/auth/roles";
import { prisma } from "@/lib/db/prisma";
import { sortVisitsForDisplay } from "@/lib/utils/visit-status";
import { getVisitSubtaskCounts, totalsForVisit } from "@/lib/utils/visit-aggregates";
import { getApprovedLeave } from "@/lib/utils/leave-check";
import { isCarryForwardVisit } from "@/lib/utils/carry-forward";
import {
  resolveClientTaskPlan,
  createTasksWithSubtasks,
  applyTaskSelection,
  MONTHLY_TASK_TYPES,
} from "@/lib/utils/create-visit";
import { normalizeAssignment } from "@/lib/utils/visit-assignment";
import { executiveVisitScope } from "@/lib/utils/visit-access";


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

    // ?taskPlanFor=<clientId> → the tasks Create Visit offers for that client:
    // exactly the task plan a new visit would be scaffolded from (the
    // client's current Task Configuration — renames, order, removed types and
    // client-specific > global subtask templates all applied), so what the
    // admin ticks is precisely what gets created. Read-only.
    const taskPlanFor = searchParams.get("taskPlanFor");
    if (taskPlanFor) {
      const client = await prisma.client.findUnique({ where: { id: taskPlanFor }, select: { id: true } });
      if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
      const plan = await resolveClientTaskPlan(taskPlanFor);
      return NextResponse.json({
        tasks: plan.map((entry) => ({
          type: entry.type,
          title: entry.title,
          orderIndex: entry.orderIndex,
          subtaskCount: entry.subtaskTitles.length,
          isMonthly: MONTHLY_TASK_TYPES.has(entry.type),
        })),
      });
    }

    const where: Record<string, unknown> = {};
    if (clientId) where.clientId = clientId;
    // Filtering by an executive uses the same scope the executive's own views
    // use, so a TEAM visit shows up for its members and not only for its lead.
    // Matching on `executiveId` alone hid every team visit from the member the
    // admin was filtering by, while the calendar (which already uses this
    // scope) listed it — the two admin screens disagreed with each other.
    if (executiveId) Object.assign(where, executiveVisitScope(executiveId));
    // Do NOT apply status filter to DB query - DB status != display status

    // Subtask progress comes from a per-visit COUNT in the database, not from
    // loading every subtask row (see lib/utils/visit-aggregates.ts). The three
    // reads below are independent, so they still run in parallel.
    // When no client/executive filter is applied the aggregate is global — it
    // does not depend on which visits come back — so it joins the parallel
    // batch instead of costing an extra sequential database round-trip on the
    // admin's most-used screen. Only the filtered case has to wait for the ids.
    const isFiltered = Boolean(clientId || executiveId);

    const [allVisits, clients, executives, unfilteredCounts] = await Promise.all([
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
      isFiltered ? Promise.resolve(null) : getVisitSubtaskCounts(undefined),
    ]);

    // Scoped to exactly the visits just fetched when a filter is applied; the
    // unfiltered admin list groups over every visit in one pass instead of
    // sending several thousand ids back as a query parameter.
    const counts = isFiltered
      ? await getVisitSubtaskCounts(allVisits.map((v) => v.id))
      : unfilteredCounts!;

    // Compute progress-based displayStatus for every visit using shared utility
    const visitsWithProgress = allVisits.map((visit) => {
      const { totalSubtasks, completedSubtasks, carryForwardCount, progress, displayStatus } =
        totalsForVisit(counts, visit.id, visit.status);
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
        ? visitsWithProgress.filter((v) => v.displayStatus === displayStatusFilter)
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
      // Team assignment (optional — omitting them keeps the previous
      // single-executive behaviour, so existing callers are unaffected).
      visitType?: "SOLO" | "TEAM";
      memberIds?: string[];
      // Per-visit task selection (optional). Omitted → the visit receives
      // the client's full Task Configuration, exactly as before. Present →
      // only these task types are created on this visit.
      selectedTaskTypes?: unknown;
    };

    const { clientId, executiveId, scheduledDate, endDate, notes } = body;

    if (!clientId || !executiveId || !scheduledDate) {
      return NextResponse.json({ error: "clientId, executiveId, and scheduledDate are required" }, { status: 400 });
    }

    const assignment = normalizeAssignment(
      { visitType: body.visitType, executiveId, memberIds: body.memberIds },
    );
    if (assignment.error) {
      return NextResponse.json({ error: assignment.error }, { status: 400 });
    }
    const team = assignment.value;

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

    // Leave conflict check — every executive on the visit, not just the lead,
    // so a team member on approved leave is caught at assignment time.
    for (const execId of [team.leadId, ...team.memberIds]) {
      const leaveConflict = await getApprovedLeave(execId, scheduledAt);
      if (!leaveConflict) continue;
      const who = await prisma.user.findUnique({ where: { id: execId }, select: { name: true } });
      const isLead = execId === team.leadId;
      return NextResponse.json(
        {
          error: team.visitType === "TEAM"
            ? `${who?.name ?? "An executive"} (${isLead ? "Team Lead" : "team member"}) is on approved leave on this date. Please select another date or change the team.`
            : "Executive is on approved leave on this date. Please select another date or another executive.",
          code: "LEAVE_CONFLICT",
        },
        { status: 409 }
      );
    }

    // Generate the visit number from the HIGHEST existing V-number, not from
    // the row count. Counting breaks permanently as soon as any visit is
    // deleted: the numbering goes sparse (e.g. 63 visits but V0070 is the
    // highest), so count+1 lands on a number that already exists and the
    // unique constraint rejects the insert. Same approach as
    // createVisitForClient's prefix-based numbering.
    const numbered = await prisma.visit.findMany({
      where: { visitNumber: { startsWith: "V" } },
      select: { visitNumber: true },
    });
    // Only plain V#### values participate; other conventions (SMC-…) are
    // ignored, as is any V-prefixed value that is not purely numeric.
    const highest = numbered.reduce((max, v) => {
      const m = /^V(\d+)$/.exec(v.visitNumber);
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, 0);
    const visitNumber = `V${String(highest + 1).padStart(4, "0")}`;

    // Repeated-client auto population: scaffold the client's CURRENT task
    // configuration (main tasks + subtasks, client-specific > global) so the
    // admin never has to recreate tasks for a returning client. Resolved
    // BEFORE the transaction — it only reads the client's configuration and
    // does not depend on the visit — so the transaction stays short.
    const fullPlan = await resolveClientTaskPlan(clientId);

    // Per-visit task selection. Only the ticked task types are created on
    // this visit, and the selection is stored on the visit so the automatic
    // sync/top-up paths (Task Configuration changes, reassignment, team
    // changes) never add an unticked task back. The client's Task
    // Configuration itself is not modified.
    let selectedTaskTypes: string[] = [];
    if (body.selectedTaskTypes !== undefined) {
      if (
        !Array.isArray(body.selectedTaskTypes) ||
        body.selectedTaskTypes.some((t) => typeof t !== "string" || !t.trim())
      ) {
        return NextResponse.json({ error: "selectedTaskTypes must be a list of task types" }, { status: 400 });
      }
      const requested = new Set(body.selectedTaskTypes as string[]);
      const chosen = fullPlan.filter((entry) => requested.has(entry.type));
      if (chosen.length === 0) {
        return NextResponse.json({ error: "Select at least one task for this visit" }, { status: 400 });
      }
      if (chosen.length !== requested.size) {
        // A ticked task is no longer in the client's configuration (it was
        // removed while the form was open). Refuse rather than silently
        // creating a visit with fewer tasks than the admin saw.
        return NextResponse.json(
          { error: "One or more selected tasks are no longer in this client's Task Configuration. Re-select the client to refresh its task list." },
          { status: 400 }
        );
      }
      // Stored in the client's configured order.
      selectedTaskTypes = chosen.map((entry) => entry.type);
    }
    const plan = applyTaskSelection(fullPlan, selectedTaskTypes);

    // Visit, team rows and the configured task structure are committed
    // TOGETHER. Previously the tasks were written after the visit had already
    // been committed, so a failure there left a visit — with its team already
    // assigned — holding no tasks at all, which is exactly what an executive
    // sees as "the visit is there but the client's tasks are missing".
    const visit = await prisma.$transaction(async (tx) => {
      const created = await tx.visit.create({
        data: {
          visitNumber,
          clientId,
          executiveId: team.leadId,
          visitType: team.visitType,
          scheduledDate: scheduledAt,
          endDate: endAt,
          notes: notes?.trim() || null,
          status: "PENDING",
          selectedTaskTypes,
          // Team rows are created alongside the visit so a TEAM visit is never
          // briefly visible without its members.
          ...(team.visitType === "TEAM" && {
            assignments: {
              create: [
                { executiveId: team.leadId, role: "LEAD" as const },
                ...team.memberIds.map((id) => ({ executiveId: id, role: "MEMBER" as const })),
              ],
            },
          }),
        },
        include: {
          client: { select: { name: true, code: true } },
          executive: { select: { name: true, email: true } },
          assignments: { select: { executiveId: true, role: true, executive: { select: { name: true } } } },
        },
      });

      await createTasksWithSubtasks(created.id, plan, tx);
      return created;
    });

    await prisma.activityLog.create({
      data: {
        visitId: visit.id,
        userId: user.userId,
        action: "VISIT_CREATED",
        metadata: {
          visitNumber,
          by: user.name,
          taskCount: plan.length,
          ...(selectedTaskTypes.length > 0 && { selectedTaskTypes }),
        },
      },
    });

    return NextResponse.json({ visit }, { status: 201 });
  } catch (error) {
    console.error("Create visit error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
