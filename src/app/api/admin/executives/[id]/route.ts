import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/middleware";
import { isAdminRole } from "@/lib/auth/roles";
import { getVisitSubtaskCounts, totalsForVisit } from "@/lib/utils/visit-aggregates";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  try {
    // Only the fields the Executive Profile modal renders. This used to
    // `include` every assigned visit with all of its tasks and subtasks, and
    // then spread the whole lot into the response ALONGSIDE the trimmed
    // `visits` array below — the same visit tree serialised twice, with the
    // full subtask rows, for a modal that shows a row per visit.
    const exec = await prisma.user.findUnique({
      where: { id, role: "EXECUTIVE" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        assignedVisits: {
          select: {
            id: true,
            visitNumber: true,
            status: true,
            scheduledDate: true,
            closedAt: true,
            client: { select: { id: true, name: true, code: true } },
          },
          orderBy: { scheduledDate: "desc" },
        },
        // `id` breaks ties: several logs are written in the same millisecond
        // (closing a visit writes VISIT_CLOSED and SUMMARY_GENERATED together),
        // and without a tiebreaker Postgres is free to return them in a
        // different order each time, so the modal's activity list reshuffled
        // itself between refreshes.
        activityLogs: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20 },
      },
    });

    if (!exec) return NextResponse.json({ error: "Executive not found" }, { status: 404 });

    // Progress/carry-forward counted in the database, one row per visit.
    const counts = await getVisitSubtaskCounts(exec.assignedVisits.map((v) => v.id));

    // Status via the shared helper so this modal agrees with the dashboard,
    // visit list and calendar (it previously derived status from subtask
    // progress alone, ignoring visit.status).
    const visits = exec.assignedVisits.map((v) => {
      const { carryForwardCount, progress, displayStatus } = totalsForVisit(counts, v.id, v.status);
      return {
        id: v.id,
        visitNumber: v.visitNumber,
        client: v.client,
        status: v.status,
        displayStatus,
        scheduledDate: v.scheduledDate,
        closedAt: v.closedAt,
        progress,
        carryForwardCount,
      };
    });

    const uniqueClients = Array.from(new Map(visits.map((v) => [v.client.id, v.client])).values());

    // `assignedVisits` is deliberately NOT spread into the response: `visits`
    // below is the trimmed view of exactly the same rows, and it is the only
    // one the modal reads.
    const { assignedVisits: _assignedVisits, ...safeExec } = exec;
    return NextResponse.json({
      executive: {
        ...safeExec,
        visits,
        assignedClients: uniqueClients,
        stats: {
          totalVisits: visits.length,
          pendingCount: visits.filter((v) => v.displayStatus === "PENDING").length,
          inProgressCount: visits.filter((v) => v.displayStatus === "IN_PROGRESS").length,
          closedCount: visits.filter((v) => v.displayStatus === "CLOSED").length,
          carryForwardCount: visits.reduce((s, v) => s + v.carryForwardCount, 0),
        },
      },
    });
  } catch (error) {
    console.error("Get executive error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  try {
    const body = await request.json();
    const { name, email, phone, isActive } = body;

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Executive not found" }, { status: 404 });

    if (email && email !== existing.email) {
      const emailTaken = await prisma.user.findUnique({ where: { email } });
      if (emailTaken) return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(name && { name: name.trim() }),
        ...(email && { email: email.toLowerCase().trim() }),
        ...(phone !== undefined && { phone: phone || null }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    const wasDeactivated = isActive === false && existing.isActive === true;
    await prisma.activityLog.create({
      data: {
        userId: user.userId,
        action: wasDeactivated ? "EXECUTIVE_DEACTIVATED" : "EXECUTIVE_UPDATED",
        metadata: { executiveId: id, executiveName: updated.name, updatedBy: user.name },
      },
    });

    const { passwordHash: _, ...safeExec } = updated;
    return NextResponse.json({ executive: safeExec });
  } catch (error) {
    console.error("Update executive error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── DELETE /api/admin/executives/[id] ────────────────────────────────────────
// Permanently deletes an executive.
//
// Deletion is blocked by BUSINESS relationships — work the executive is tied to
// that another person or record depends on. It is NOT blocked by the
// executive's own sign-in history.
//
// That distinction is the whole point. This check previously counted EVERY
// activity_logs row for the user, and simply logging in writes a USER_LOGIN
// row. So the moment an executive signed in even once they became permanently
// undeletable, and the admin was told to "reassign clients and upcoming visits"
// that did not exist — an account with no client, no visit and no task at all
// still reported that message. The guard was reporting session noise as
// business data.
//
// Blocking (someone/something else depends on it):
//   assigned clients · visits owned · team memberships · leave · reassignments
//   · delegations · admin operations · carry-forward approvals · any activity
//   log recording actual WORK (anything other than sign-in/sign-out)
//
// Removed with the executive (theirs alone, meaningless once they are gone,
// and only ever reached when every business check above passed):
//   their USER_LOGIN / USER_LOGOUT rows · their attendance rows
//
// Protection for a real executive is therefore unchanged: anyone holding a
// client, a visit of any status, or a record of real work is still refused.

/** Activity-log actions that are pure session bookkeeping, not work. */
const SESSION_LOG_ACTIONS = ["USER_LOGIN", "USER_LOGOUT"] as const;

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  try {
    const existing = await prisma.user.findUnique({ where: { id, role: "EXECUTIVE" } });
    if (!existing) return NextResponse.json({ error: "Executive not found" }, { status: 404 });

    const [
      visitCount,
      clientCount,
      seniorClientCount,
      assignmentCount,
      leaveOwnCount,
      leaveReviewedCount,
      reassignFromCount,
      reassignToCount,
      reassignByCount,
      delegationFromCount,
      delegationToCount,
      adminOperationCount,
      carryForwardApprovalCount,
      workLogCount,
    ] = await Promise.all([
      prisma.visit.count({ where: { executiveId: id } }),
      prisma.client.count({ where: { assignedExecId: id } }),
      prisma.client.count({ where: { seniorExecId: id } }),
      prisma.visitAssignment.count({ where: { executiveId: id } }),
      prisma.leaveRequest.count({ where: { executiveId: id } }),
      prisma.leaveRequest.count({ where: { reviewedById: id } }),
      prisma.visitReassignment.count({ where: { fromExecutiveId: id } }),
      prisma.visitReassignment.count({ where: { toExecutiveId: id } }),
      prisma.visitReassignment.count({ where: { reassignedById: id } }),
      prisma.visitDelegation.count({ where: { fromExecutiveId: id } }),
      prisma.visitDelegation.count({ where: { toExecutiveId: id } }),
      prisma.adminOperation.count({ where: { userId: id } }),
      prisma.subtask.count({ where: { carryForwardApprovedById: id } }),
      // Activity that records real WORK — anything that is not sign-in/out.
      prisma.activityLog.count({ where: { userId: id, action: { notIn: [...SESSION_LOG_ACTIONS] } } }),
    ]);

    // Named so the admin is told what actually blocks, instead of being sent to
    // reassign clients and visits that may not exist.
    const blockers: string[] = [];
    const add = (n: number, one: string, many = `${one}s`) => {
      if (n > 0) blockers.push(`${n} ${n === 1 ? one : many}`);
    };
    add(clientCount + seniorClientCount, "assigned client");
    add(visitCount, "visit");
    add(assignmentCount, "team visit membership", "team visit memberships");
    add(leaveOwnCount + leaveReviewedCount, "leave request");
    add(reassignFromCount + reassignToCount + reassignByCount, "visit reassignment");
    add(delegationFromCount + delegationToCount, "visit delegation");
    add(adminOperationCount, "recorded admin operation");
    add(carryForwardApprovalCount, "carry-forward approval");
    add(workLogCount, "recorded action");

    if (blockers.length > 0) {
      return NextResponse.json(
        {
          error:
            `This executive still has ${blockers.join(", ")}. ` +
            `Reassign their clients and visits before deleting them.`,
          blockedBy: blockers,
        },
        { status: 409 }
      );
    }

    // Nothing business-related is attached. Remove the executive together with
    // the two kinds of record that exist only because the account existed, in
    // ONE transaction so the account is never left half-removed.
    const removed = await prisma.$transaction(async (tx) => {
      const sessionLogs = await tx.activityLog.deleteMany({
        where: { userId: id, action: { in: [...SESSION_LOG_ACTIONS] } },
      });
      const attendance = await tx.attendance.deleteMany({ where: { executiveId: id } });
      await tx.user.delete({ where: { id } });
      return { sessionLogs: sessionLogs.count, attendance: attendance.count };
    });

    await prisma.activityLog.create({
      data: {
        userId: user.userId,
        action: "EXECUTIVE_DELETED",
        metadata: {
          executiveId: id,
          executiveName: existing.name,
          executiveEmail: existing.email,
          deletedBy: user.name,
          removedSessionLogs: removed.sessionLogs,
          removedAttendance: removed.attendance,
        },
      },
    });

    return NextResponse.json({ success: true, removed });
  } catch (error) {
    console.error("Delete executive error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
