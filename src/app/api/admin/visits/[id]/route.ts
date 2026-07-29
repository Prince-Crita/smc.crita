import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/middleware";
import { isAdminRole } from "@/lib/auth/roles";

// ─── DELETE /api/admin/visits/[id] ────────────────────────────────────────────
// Removes a visit assignment completely (used by Admin → Executive → View
// Details → "Remove Visit"). This unassigns the visit from its executive by
// deleting the Visit row outright — Task/Subtask cascade-delete automatically
// (schema onDelete: Cascade). ActivityLog/VisitReassignment/VisitDelegation
// rows referencing this visit have no cascade defined, so they're cleared
// first to avoid leaving orphaned references and to let the delete succeed.
//
// Closed visits are completed audit records, not "assignments" — they're
// blocked here to avoid destroying finished work through this action.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  try {
    const visit = await prisma.visit.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, name: true } },
        executive: { select: { id: true, name: true } },
      },
    });
    if (!visit) return NextResponse.json({ error: "Visit not found" }, { status: 404 });

    if (visit.status === "CLOSED") {
      return NextResponse.json(
        { error: "Cannot remove a closed visit — it is completed audit history." },
        { status: 409 }
      );
    }

    // Clear dependent rows that have no cascade-delete from Visit
    await prisma.activityLog.deleteMany({ where: { visitId: id } });
    await prisma.visitReassignment.deleteMany({ where: { visitId: id } });
    await prisma.visitDelegation.deleteMany({ where: { visitId: id } });

    // Task/Subtask cascade automatically via schema
    await prisma.visit.delete({ where: { id } });

    // Log the removal against the client (the visit itself no longer exists)
    await prisma.activityLog.create({
      data: {
        userId: user.userId,
        action: "VISIT_REMOVED",
        metadata: {
          visitId: id,
          visitNumber: visit.visitNumber,
          clientId: visit.client.id,
          clientName: visit.client.name,
          executiveId: visit.executive.id,
          executiveName: visit.executive.name,
          removedBy: user.name,
        },
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Remove visit error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
