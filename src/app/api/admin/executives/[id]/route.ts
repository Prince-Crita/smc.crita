import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/middleware";
import { isAdminRole } from "@/lib/auth/roles";
import { getSubtaskTotals } from "@/lib/utils/visit-status";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  try {
    const exec = await prisma.user.findUnique({
      where: { id, role: "EXECUTIVE" },
      include: {
        assignedVisits: {
          include: {
            client: { select: { id: true, name: true, code: true } },
            tasks: { include: { subtasks: { select: { isCompleted: true, isCarriedForward: true } } } },
          },
          orderBy: { scheduledDate: "desc" },
        },
        activityLogs: { orderBy: { createdAt: "desc" }, take: 20 },
        assignedClients: { select: { id: true, name: true } },
      },
    });

    if (!exec) return NextResponse.json({ error: "Executive not found" }, { status: 404 });

    // Status via the shared helper so this modal agrees with the dashboard,
    // visit list and calendar (it previously derived status from subtask
    // progress alone, ignoring visit.status).
    const visits = exec.assignedVisits.map((v: any) => {
      const { carryForwardCount, progress, displayStatus } = getSubtaskTotals(v.tasks, v.status);
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

    const { passwordHash: _, ...safeExec } = exec;
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
// Permanently deletes an executive. Only allowed when the executive has zero
// footprint (no visits ever, no assigned clients, no attendance/leave/activity
// history) — Visit.executiveId and similar FKs are required and have no
// cascade-delete from User, so any history would otherwise block the delete
// at the database level anyway.

const BLOCKED_MESSAGE = "Reassign clients and upcoming visits before deleting this executive.";

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
      attendanceCount,
      leaveCount,
      reassignFromCount,
      reassignToCount,
      reassignByCount,
      delegationFromCount,
      delegationToCount,
      activityLogCount,
    ] = await Promise.all([
      prisma.visit.count({ where: { executiveId: id } }),
      prisma.client.count({ where: { assignedExecId: id } }),
      prisma.attendance.count({ where: { executiveId: id } }),
      prisma.leaveRequest.count({ where: { executiveId: id } }),
      prisma.visitReassignment.count({ where: { fromExecutiveId: id } }),
      prisma.visitReassignment.count({ where: { toExecutiveId: id } }),
      prisma.visitReassignment.count({ where: { reassignedById: id } }),
      prisma.visitDelegation.count({ where: { fromExecutiveId: id } }),
      prisma.visitDelegation.count({ where: { toExecutiveId: id } }),
      prisma.activityLog.count({ where: { userId: id } }),
    ]);

    const hasFootprint =
      visitCount > 0 || clientCount > 0 || attendanceCount > 0 || leaveCount > 0 ||
      reassignFromCount > 0 || reassignToCount > 0 || reassignByCount > 0 ||
      delegationFromCount > 0 || delegationToCount > 0 || activityLogCount > 0;

    if (hasFootprint) {
      return NextResponse.json({ error: BLOCKED_MESSAGE }, { status: 409 });
    }

    await prisma.user.delete({ where: { id } });

    await prisma.activityLog.create({
      data: {
        userId: user.userId,
        action: "EXECUTIVE_DELETED",
        metadata: { executiveId: id, executiveName: existing.name, deletedBy: user.name },
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete executive error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
