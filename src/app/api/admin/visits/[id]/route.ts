import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/middleware";
import { isAdminRole } from "@/lib/auth/roles";
import { deleteVisitDeep, VisitNotFoundError } from "@/lib/utils/delete-visit";
import { recordOperation } from "@/lib/utils/admin-operations";

// ─── DELETE /api/admin/visits/[id] ────────────────────────────────────────────
// Deletes ONE visit occurrence and only the records that belong to that
// occurrence. Used by
//   • Admin → Executive → View Details → "Remove Visit"  (default behaviour)
//   • Admin → Calendar → visit card → "Delete"           (?allowClosed=1)
//
// Scope: everything is keyed on this visit's id — never on clientId. The
// client row, its other visits, its task-type configuration and its subtask
// templates are never touched, and neither is any other executive's visit.
// See lib/utils/delete-visit.ts for the full dependency list; the delete runs
// in a single transaction, so it either completes or changes nothing.
//
// Closed visits are completed audit history. They stay blocked by default
// (the "Remove Visit" action is about un-assigning upcoming work), and are
// deletable only when the caller explicitly opts in with ?allowClosed=1 —
// which the Calendar's Delete dialog does, after warning the admin.
//
// ADMIN / SUPER_ADMIN only. An executive's session is rejected here with 403
// regardless of what the UI shows them.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const allowClosed = new URL(request.url).searchParams.get("allowClosed") === "1";

  try {
    const visit = await prisma.visit.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!visit) return NextResponse.json({ error: "Visit not found" }, { status: 404 });

    if (visit.status === "CLOSED" && !allowClosed) {
      return NextResponse.json(
        { error: "Cannot remove a closed visit — it is completed audit history." },
        { status: 409 }
      );
    }

    const deleted = await deleteVisitDeep(id);

    // Logged against the client, since the visit itself no longer exists (an
    // ActivityLog row pointing at a deleted visit is exactly the dangling
    // reference this endpoint exists to avoid).
    await prisma.activityLog.create({
      data: {
        userId: user.userId,
        action: "VISIT_REMOVED",
        metadata: {
          visitId: id,
          visitNumber: deleted.visitNumber,
          clientId: deleted.clientId,
          clientName: deleted.clientName,
          executiveId: deleted.executiveId,
          executiveName: deleted.executiveName,
          scheduledDate: deleted.scheduledDate.toISOString(),
          previousStatus: deleted.status,
          removedBy: user.name,
          removed: deleted.removed,
        },
      },
    });

    // Recorded for the Super Admin activity view but explicitly NOT
    // reversible: the visit's tasks and subtasks were cascade-deleted, and
    // recreating that tree would invent new ids and fake relations.
    await recordOperation({
      userId: user.userId,
      action: "VISIT_DELETED",
      entityType: "Visit",
      entityId: id,
      summary: `Visit ${deleted.visitNumber} (${deleted.clientName}, ${deleted.scheduledDate.toISOString().split("T")[0]}) deleted by ${user.name}`,
      before: {
        visitNumber: deleted.visitNumber,
        clientId: deleted.clientId,
        clientName: deleted.clientName,
        executiveId: deleted.executiveId,
        status: deleted.status,
        scheduledDate: deleted.scheduledDate,
        removed: deleted.removed,
      },
      isReversible: false,
    });

    return NextResponse.json({
      success: true,
      visitNumber: deleted.visitNumber,
      clientName: deleted.clientName,
      affectedExecutiveIds: deleted.affectedExecutiveIds,
      removed: deleted.removed,
    });
  } catch (error) {
    // Lost a race with another admin deleting the same visit — the end state
    // the caller wanted is already true, but nothing of theirs was written.
    if (error instanceof VisitNotFoundError) {
      return NextResponse.json({ error: "Visit not found" }, { status: 404 });
    }
    console.error("Delete visit error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
