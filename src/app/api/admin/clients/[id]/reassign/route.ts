/**
 * POST /api/admin/clients/[id]/reassign
 *
 * Client-level executive reassignment.
 * Reassigns ALL pending/open visits for this client to a new executive.
 * Also updates client.assignedExecId to the new executive.
 *
 * Body: { toExecutiveId: string, reason: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/middleware";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: clientId } = await params;

  try {
    const body = await request.json();
    const { toExecutiveId, reason } = body;

    if (!toExecutiveId) return NextResponse.json({ error: "toExecutiveId is required" }, { status: 400 });
    if (!reason || reason.trim().length < 5)
      return NextResponse.json({ error: "Reason must be at least 5 characters" }, { status: 400 });

    // Validate client exists
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, name: true, assignedExecId: true },
    });
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    // Validate target executive
    const toExec = await prisma.user.findUnique({
      where: { id: toExecutiveId, role: "EXECUTIVE", isActive: true },
      select: { id: true, name: true },
    });
    if (!toExec) return NextResponse.json({ error: "Target executive not found or inactive" }, { status: 404 });

    if (client.assignedExecId === toExecutiveId)
      return NextResponse.json({ error: "Client is already assigned to this executive" }, { status: 400 });

    // Get current exec info for logging
    const fromExec = client.assignedExecId
      ? await prisma.user.findUnique({
          where: { id: client.assignedExecId },
          select: { id: true, name: true },
        })
      : null;

    // Find all pending/open visits for this client
    const visitsToReassign = await prisma.visit.findMany({
      where: { clientId, status: { in: ["PENDING", "OPEN"] } },
      select: { id: true, visitNumber: true, executiveId: true },
    });

    // Reassign all visits + update client assignedExecId in a transaction
    const [, , reassignments] = await prisma.$transaction([
      // 1. Update client assignedExecId
      prisma.client.update({
        where: { id: clientId },
        data: { assignedExecId: toExecutiveId },
      }),
      // 2. Bulk-update all pending/open visits to new executive
      prisma.visit.updateMany({
        where: { clientId, status: { in: ["PENDING", "OPEN"] } },
        data: { executiveId: toExecutiveId },
      }),
      // 3. Create VisitReassignment records for each visit
      ...visitsToReassign.length > 0
        ? [
            prisma.visitReassignment.createMany({
              data: visitsToReassign.map((v) => ({
                visitId: v.id,
                fromExecutiveId: v.executiveId,
                toExecutiveId,
                reason: reason.trim(),
                reassignedById: user.userId,
              })),
            }),
          ]
        : [prisma.$queryRaw`SELECT 1`],
    ]);

    // Log activity for each reassigned visit
    if (visitsToReassign.length > 0) {
      await prisma.activityLog.createMany({
        data: visitsToReassign.map((v) => ({
          visitId: v.id,
          userId: user.userId,
          action: "VISIT_REASSIGNED" as const,
          metadata: {
            visitNumber: v.visitNumber,
            clientName: client.name,
            fromExecutiveName: fromExec?.name ?? "Unknown",
            toExecutiveName: toExec.name,
            reason: reason.trim(),
            reassignedBy: user.name,
            bulkReassign: true,
          },
        })),
      });
    }

    return NextResponse.json({
      success: true,
      visitsReassigned: visitsToReassign.length,
      fromExecutive: fromExec?.name ?? null,
      toExecutive: toExec.name,
    });
  } catch (error) {
    console.error("Client reassign error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
