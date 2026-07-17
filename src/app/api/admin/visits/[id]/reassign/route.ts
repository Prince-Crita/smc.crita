import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/middleware";
import { getApprovedLeave } from "@/lib/utils/leave-check";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: visitId } = await params;

  try {
    const body = await request.json();
    const { toExecutiveId, reason, scheduledDate } = body as {
      toExecutiveId: string; reason: string; scheduledDate?: string;
    };

    if (!toExecutiveId) return NextResponse.json({ error: "toExecutiveId is required" }, { status: 400 });
    if (!reason || reason.trim().length < 5) return NextResponse.json({ error: "Reason must be at least 5 characters" }, { status: 400 });

    let newDate: Date | null = null;
    if (scheduledDate) {
      newDate = new Date(scheduledDate);
      if (isNaN(newDate.getTime())) return NextResponse.json({ error: "Invalid scheduledDate" }, { status: 400 });
    }

    const visit = await prisma.visit.findUnique({
      where: { id: visitId },
      include: { executive: { select: { id: true, name: true } }, client: { select: { name: true } } },
    });
    if (!visit) return NextResponse.json({ error: "Visit not found" }, { status: 404 });
    if (visit.status === "CLOSED") return NextResponse.json({ error: "Cannot reassign a closed visit" }, { status: 400 });
    if (visit.executiveId === toExecutiveId && !newDate) return NextResponse.json({ error: "Visit is already assigned to this executive" }, { status: 400 });

    const toExec = await prisma.user.findUnique({ where: { id: toExecutiveId, role: "EXECUTIVE", isActive: true } });
    if (!toExec) return NextResponse.json({ error: "Target executive not found or inactive" }, { status: 404 });

    // Leave conflict check — block if the (new) executive has approved leave on the (new/unchanged) date
    const dateToCheck = newDate ?? visit.scheduledDate;
    const leaveConflict = await getApprovedLeave(toExecutiveId, dateToCheck);
    if (leaveConflict) {
      return NextResponse.json(
        {
          error: "Executive is on approved leave on this date. Please select another date or assign a different executive.",
          code: "LEAVE_CONFLICT",
        },
        { status: 409 }
      );
    }

    // Create reassignment record
    const reassignment = await prisma.visitReassignment.create({
      data: { visitId, fromExecutiveId: visit.executiveId, toExecutiveId, reason: reason.trim(), reassignedById: user.userId },
    });

    // Update visit
    await prisma.visit.update({
      where: { id: visitId },
      data: {
        executiveId: toExecutiveId,
        ...(newDate ? { scheduledDate: newDate } : {}),
      },
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        visitId,
        userId: user.userId,
        action: "VISIT_REASSIGNED",
        metadata: {
          visitNumber: visit.visitNumber,
          clientName: visit.client.name,
          fromExecutiveName: visit.executive.name,
          toExecutiveName: toExec.name,
          reason: reason.trim(),
          reassignedBy: user.name,
          ...(newDate ? { previousScheduledDate: visit.scheduledDate.toISOString(), newScheduledDate: newDate.toISOString() } : {}),
        },
      },
    });

    return NextResponse.json({ success: true, reassignment });
  } catch (error) {
    console.error("Reassign visit error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
