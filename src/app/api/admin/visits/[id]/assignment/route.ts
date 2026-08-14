import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/middleware";
import { isAdminRole } from "@/lib/auth/roles";
import { getApprovedLeave } from "@/lib/utils/leave-check";
import { applyAssignment, normalizeAssignment, readAssignment } from "@/lib/utils/visit-assignment";
import { recordOperation } from "@/lib/utils/admin-operations";

// ─── GET /api/admin/visits/[id]/assignment ───────────────────────────────────
// Current assignment for a visit, in the shape PATCH accepts. Used by the
// admin assignment editor and by the Duplicate Client flow to show the
// previous assignment before duplicating.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: visitId } = await params;

  try {
    const visit = await prisma.visit.findUnique({
      where: { id: visitId },
      select: {
        id: true,
        visitNumber: true,
        visitType: true,
        scheduledDate: true,
        executive: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
        assignments: {
          select: { executiveId: true, role: true, executive: { select: { id: true, name: true } } },
        },
      },
    });
    if (!visit) return NextResponse.json({ error: "Visit not found" }, { status: 404 });

    return NextResponse.json({
      assignment: {
        visitId: visit.id,
        visitNumber: visit.visitNumber,
        clientName: visit.client.name,
        scheduledDate: visit.scheduledDate,
        visitType: visit.visitType,
        teamLead: { id: visit.executive.id, name: visit.executive.name },
        teamMembers: visit.assignments
          .filter((a) => a.role !== "LEAD")
          .map((a) => ({ id: a.executive.id, name: a.executive.name })),
      },
    });
  } catch (error) {
    console.error("Get visit assignment error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── PATCH /api/admin/visits/[id]/assignment ─────────────────────────────────
// Change a visit's assignment in place: SOLO ↔ TEAM, change the Team Lead, or
// add/remove members. Body: { visitType, executiveId, memberIds[] }
//
// The visit row itself is updated — never recreated — so no duplicate visit
// appears and the visit's tasks, subtasks, progress and history stay intact.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: visitId } = await params;

  try {
    const body = await request.json().catch(() => ({})) as {
      visitType?: "SOLO" | "TEAM";
      executiveId?: string;
      memberIds?: string[];
      reason?: string;
      /** Optional date change applied to the SAME visit (never a new one). */
      scheduledDate?: string;
    };

    const visit = await prisma.visit.findUnique({
      where: { id: visitId },
      include: {
        executive: { select: { id: true, name: true } },
        client: { select: { name: true } },
        assignments: { select: { executiveId: true, role: true } },
      },
    });
    if (!visit) return NextResponse.json({ error: "Visit not found" }, { status: 404 });
    if (visit.status === "CLOSED") {
      return NextResponse.json({ error: "Cannot change the assignment of a closed visit" }, { status: 400 });
    }

    const normalized = normalizeAssignment(
      { visitType: body.visitType, executiveId: body.executiveId, memberIds: body.memberIds },
      visit.executiveId
    );
    if (normalized.error) return NextResponse.json({ error: normalized.error }, { status: 400 });
    const next = normalized.value;

    // Every named executive must exist, be an EXECUTIVE and be active.
    const execIds = [next.leadId, ...next.memberIds];
    const execs = await prisma.user.findMany({
      where: { id: { in: execIds }, role: "EXECUTIVE", isActive: true },
      select: { id: true, name: true },
    });
    if (execs.length !== execIds.length) {
      return NextResponse.json({ error: "One or more selected executives were not found or are inactive" }, { status: 400 });
    }
    const nameById = new Map(execs.map((e) => [e.id, e.name]));

    let newDate: Date | null = null;
    if (body.scheduledDate) {
      newDate = new Date(body.scheduledDate);
      if (isNaN(newDate.getTime())) {
        return NextResponse.json({ error: "Invalid scheduledDate" }, { status: 400 });
      }
    }
    const effectiveDate = newDate ?? visit.scheduledDate;

    // Leave conflicts, checked for the whole team on the visit's date.
    for (const execId of execIds) {
      const conflict = await getApprovedLeave(execId, effectiveDate);
      if (conflict) {
        return NextResponse.json(
          {
            error: `${nameById.get(execId) ?? "An executive"} is on approved leave on this date. Please select another date or change the assignment.`,
            code: "LEAVE_CONFLICT",
          },
          { status: 409 }
        );
      }
    }

    const previous = await readAssignment(prisma, visitId);
    const leadChanged = previous ? previous.leadId !== next.leadId : false;

    await prisma.$transaction(async (tx) => {
      await applyAssignment(tx, visitId, next);

      // Date change is applied to the same visit row — never by creating one.
      if (newDate) {
        await tx.visit.update({ where: { id: visitId }, data: { scheduledDate: newDate } });
      }

      // A lead change is a genuine handover — keep it in the existing
      // reassignment history so the audit trail stays complete.
      if (leadChanged && previous) {
        await tx.visitReassignment.create({
          data: {
            visitId,
            fromExecutiveId: previous.leadId,
            toExecutiveId: next.leadId,
            reason: body.reason?.trim() || "Visit assignment changed by admin",
            reassignedById: user.userId,
          },
        });
      }

      await tx.activityLog.create({
        data: {
          visitId,
          userId: user.userId,
          action: leadChanged ? "VISIT_REASSIGNED" : "SUBTASK_TEMPLATE_UPDATED",
          metadata: {
            action: "visit_assignment_updated",
            visitNumber: visit.visitNumber,
            clientName: visit.client.name,
            previousVisitType: previous?.visitType,
            newVisitType: next.visitType,
            previousLeadName: visit.executive.name,
            newLeadName: nameById.get(next.leadId),
            teamMemberNames: next.memberIds.map((id) => nameById.get(id)),
            updatedBy: user.name,
          },
        },
      });
    });

    // Reversible: restoring executiveId/visitType returns the visit to its
    // previous owner. `memberIds` is recorded too — team membership lives in
    // VisitAssignment rows, not on the visit, so without it an undo would
    // restore the lead and silently leave the previous members behind. Undo
    // replays it through the same applyAssignment path used here, so the
    // visit, its tasks, subtasks and history are never recreated.
    await recordOperation({
      userId: user.userId,
      action: "VISIT_ASSIGNMENT_UPDATED",
      entityType: "Visit",
      entityId: visitId,
      summary: `Visit ${visit.visitNumber} assignment changed to ${next.visitType} by ${user.name}`,
      reason: body.reason?.trim() || null,
      before: {
        executiveId: visit.executiveId,
        visitType: visit.visitType,
        memberIds: previous?.memberIds ?? [],
      },
      after: { executiveId: next.leadId, visitType: next.visitType, memberIds: next.memberIds },
    });

    const assignment = await readAssignment(prisma, visitId);
    return NextResponse.json({
      success: true,
      assignment: {
        visitType: assignment?.visitType,
        teamLead: { id: next.leadId, name: nameById.get(next.leadId) },
        teamMembers: next.memberIds.map((id) => ({ id, name: nameById.get(id) })),
      },
    });
  } catch (error) {
    console.error("Update visit assignment error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
