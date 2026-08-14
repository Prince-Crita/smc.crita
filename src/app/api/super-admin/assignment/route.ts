import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireSuperAdmin } from "@/lib/utils/super-admin";
import { recordOperation } from "@/lib/utils/admin-operations";
import { normalizeAssignment, applyAssignment, readAssignment } from "@/lib/utils/visit-assignment";
import { getApprovedLeave } from "@/lib/utils/leave-check";

// ─── PATCH /api/super-admin/assignment ───────────────────────────────────────
// Correct a visit's Solo/Team configuration, its Team Lead or its members (§2).
//
// This does NOT reimplement the assignment rules. It runs the same
// normalizeAssignment / applyAssignment path the admin workflow uses, so the
// invariants that everything else depends on still hold:
//   • Visit.executiveId stays the owner (solo executive, or team LEAD)
//   • a SOLO visit carries no assignment rows; a TEAM visit carries LEAD + members
//   • the same executive can never appear twice
//   • an executive on approved leave that day is refused
//
// The visit row itself is only ever UPDATED — never recreated — so no duplicate
// visit appears and no task, subtask or completion history is touched.
//
// Body: { visitId, visitType, executiveId, memberIds?, reason? }
export async function PATCH(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if (gate.response) return gate.response;
  const actor = gate.user!;

  try {
    const body = await request.json().catch(() => ({})) as {
      visitId?: string;
      visitType?: "SOLO" | "TEAM";
      executiveId?: string;
      memberIds?: string[];
      reason?: string;
    };
    if (!body.visitId) {
      return NextResponse.json({ error: "visitId is required" }, { status: 400 });
    }

    const visit = await prisma.visit.findUnique({
      where: { id: body.visitId },
      select: {
        id: true, visitNumber: true, executiveId: true, visitType: true,
        scheduledDate: true, status: true,
        client: { select: { name: true } },
        executive: { select: { name: true } },
      },
    });
    if (!visit) return NextResponse.json({ error: "Visit not found" }, { status: 404 });

    const normalized = normalizeAssignment(
      { visitType: body.visitType, executiveId: body.executiveId, memberIds: body.memberIds },
      visit.executiveId
    );
    if (normalized.error) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }
    const next = normalized.value!;

    // Every named executive must exist, be an EXECUTIVE and be active.
    const execIds = [next.leadId, ...next.memberIds];
    const execs = await prisma.user.findMany({
      where: { id: { in: execIds }, role: "EXECUTIVE", isActive: true },
      select: { id: true, name: true },
    });
    if (execs.length !== execIds.length) {
      return NextResponse.json(
        { error: "One or more selected executives were not found, are inactive, or are not executives." },
        { status: 400 }
      );
    }
    const nameById = new Map(execs.map((e) => [e.id, e.name]));

    // Approved leave is still a hard stop — a correction must not park work on
    // somebody who is away.
    for (const execId of execIds) {
      const conflict = await getApprovedLeave(execId, visit.scheduledDate);
      if (conflict) {
        return NextResponse.json(
          {
            error: `${nameById.get(execId) ?? "An executive"} is on approved leave on this visit's date.`,
            code: "LEAVE_CONFLICT",
          },
          { status: 409 }
        );
      }
    }

    const previous = await readAssignment(prisma, visit.id);
    const leadChanged = previous ? previous.leadId !== next.leadId : false;

    await prisma.$transaction(async (tx) => {
      await applyAssignment(tx, visit.id, next);

      // A lead change is a real handover — keep it in the existing
      // reassignment history so that trail stays complete.
      if (leadChanged && previous) {
        await tx.visitReassignment.create({
          data: {
            visitId: visit.id,
            fromExecutiveId: previous.leadId,
            toExecutiveId: next.leadId,
            reason: body.reason?.trim() || "Assignment corrected by Super Admin",
            reassignedById: actor.userId,
          },
        });
      }

      await tx.activityLog.create({
        data: {
          visitId: visit.id,
          userId: actor.userId,
          action: leadChanged ? "VISIT_REASSIGNED" : "SUBTASK_TEMPLATE_UPDATED",
          metadata: {
            action: "super_admin_assignment_corrected",
            visitNumber: visit.visitNumber,
            clientName: visit.client.name,
            previousVisitType: previous?.visitType,
            newVisitType: next.visitType,
            previousLeadName: visit.executive.name,
            newLeadName: nameById.get(next.leadId),
            teamMemberNames: next.memberIds.map((id) => nameById.get(id)),
            correctedBy: actor.name,
          },
        },
      });
    });

    // Reversible: `memberIds` travels with the scalars so undo restores the
    // team exactly, through the same applyAssignment path used above.
    const operationId = await recordOperation({
      userId: actor.userId,
      action: "SUPER_ADMIN_ASSIGNMENT_CORRECTED",
      entityType: "Visit",
      entityId: visit.id,
      summary:
        `Visit ${visit.visitNumber} assignment corrected by ${actor.name} — ` +
        `${previous?.visitType ?? visit.visitType} → ${next.visitType}, ` +
        `lead ${visit.executive.name} → ${nameById.get(next.leadId)}`,
      reason: body.reason ?? null,
      before: {
        executiveId: visit.executiveId,
        visitType: visit.visitType,
        memberIds: previous?.memberIds ?? [],
      },
      after: { executiveId: next.leadId, visitType: next.visitType, memberIds: next.memberIds },
      isReversible: true,
    });

    const assignment = await readAssignment(prisma, visit.id);
    return NextResponse.json({
      success: true,
      operationId,
      assignment: {
        visitType: assignment?.visitType,
        teamLead: { id: next.leadId, name: nameById.get(next.leadId) },
        teamMembers: next.memberIds.map((id) => ({ id, name: nameById.get(id) })),
      },
    });
  } catch (error) {
    console.error("Super admin assignment correction error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
