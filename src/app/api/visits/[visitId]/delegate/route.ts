import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { prisma } from "@/lib/db/prisma";

// ─── GET /api/visits/[visitId]/delegate ────────────────────────────────────
// Returns list of executives available to delegate to (all active execs except
// the current executive who owns the visit)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ visitId: string }> }
) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "EXECUTIVE") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { visitId } = await params;

  try {
    const visit = await prisma.visit.findUnique({
      where: { id: visitId },
      select: { executiveId: true, status: true },
    });

    if (!visit) {
      return NextResponse.json({ error: "Visit not found" }, { status: 404 });
    }
    if (visit.executiveId !== user.userId) {
      return NextResponse.json({ error: "Not your visit" }, { status: 403 });
    }

    // All active executives except the current one
    const executives = await prisma.user.findMany({
      where: { role: "EXECUTIVE", isActive: true, id: { not: user.userId } },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    });

    // Also return any pending/rejected delegation for this visit+executive
    const existingDelegation = await prisma.visitDelegation.findFirst({
      where: {
        visitId,
        fromExecutiveId: user.userId,
        status: { in: ["PENDING", "REJECTED"] },
      },
      orderBy: { createdAt: "desc" },
      include: {
        toExecutive: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ executives, existingDelegation });
  } catch (error) {
    console.error("Delegate GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST /api/visits/[visitId]/delegate ───────────────────────────────────
// Executive submits a delegation request for a visit
// Body: { toExecutiveId: string, leaveDate: string, leaveReason: string }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ visitId: string }> }
) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "EXECUTIVE") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { visitId } = await params;

  try {
    const body = await request.json() as {
      toExecutiveId: string;
      leaveDate: string;
      leaveReason: string;
    };
    const { toExecutiveId, leaveDate, leaveReason } = body;

    if (!toExecutiveId || !leaveDate || !leaveReason?.trim()) {
      return NextResponse.json(
        { error: "toExecutiveId, leaveDate and leaveReason are required" },
        { status: 400 }
      );
    }

    const visit = await prisma.visit.findUnique({
      where: { id: visitId },
      include: { client: { select: { name: true } } },
    });

    if (!visit) {
      return NextResponse.json({ error: "Visit not found" }, { status: 404 });
    }
    if (visit.executiveId !== user.userId) {
      return NextResponse.json({ error: "Not your visit" }, { status: 403 });
    }
    if (visit.status === "CLOSED") {
      return NextResponse.json({ error: "Visit is already closed" }, { status: 409 });
    }

    // Verify target executive exists and is active
    const toExec = await prisma.user.findUnique({
      where: { id: toExecutiveId, role: "EXECUTIVE", isActive: true },
      select: { id: true, name: true },
    });
    if (!toExec) {
      return NextResponse.json({ error: "Target executive not found" }, { status: 404 });
    }

    const leaveDateUtc = new Date(leaveDate);
    leaveDateUtc.setUTCHours(0, 0, 0, 0);

    // Cancel any previous REJECTED delegation for same visit+fromExec
    await prisma.visitDelegation.updateMany({
      where: { visitId, fromExecutiveId: user.userId, status: "REJECTED" },
      data: { status: "REJECTED" }, // no-op, just keeping them as history
    });

    // Cancel any previous PENDING delegation so only one is active
    await prisma.visitDelegation.updateMany({
      where: { visitId, fromExecutiveId: user.userId, status: "PENDING" },
      data: { status: "REJECTED", rejectionReason: "Superseded by new delegation request" },
    });

    const delegation = await prisma.visitDelegation.create({
      data: {
        visitId,
        fromExecutiveId: user.userId,
        toExecutiveId,
        leaveDate: leaveDateUtc,
        leaveReason: leaveReason.trim(),
        status: "PENDING",
      },
      include: {
        toExecutive: { select: { id: true, name: true } },
        fromExecutive: { select: { id: true, name: true } },
        visit: { select: { visitNumber: true, client: { select: { name: true } } } },
      },
    });

    return NextResponse.json({ delegation }, { status: 201 });
  } catch (error) {
    console.error("Delegate POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
