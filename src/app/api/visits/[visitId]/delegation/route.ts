import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { prisma } from "@/lib/db/prisma";

function toMidnightUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// ─── GET /api/visits/[visitId]/delegation ──────────────────────────────────
// Returns pending delegation requests directed AT the current executive
// Also used by the from-executive to check status of their delegation
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
    // Find delegation where this user is either from or to
    const delegation = await prisma.visitDelegation.findFirst({
      where: {
        visitId,
        OR: [
          { fromExecutiveId: user.userId },
          { toExecutiveId: user.userId },
        ],
        status: { in: ["PENDING", "REJECTED"] },
      },
      orderBy: { createdAt: "desc" },
      include: {
        fromExecutive: { select: { id: true, name: true } },
        toExecutive:   { select: { id: true, name: true } },
        visit: {
          select: {
            visitNumber: true,
            scheduledDate: true,
            client: { select: { name: true } },
          },
        },
      },
    });

    return NextResponse.json({ delegation });
  } catch (error) {
    console.error("Delegation GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── PATCH /api/visits/[visitId]/delegation ────────────────────────────────
// Target executive accepts or rejects a delegation request
// Body: { delegationId: string, action: "ACCEPT" | "REJECT", rejectionReason?: string }
export async function PATCH(
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
      delegationId: string;
      action: "ACCEPT" | "REJECT";
      rejectionReason?: string;
    };
    const { delegationId, action, rejectionReason } = body;

    if (!delegationId || !["ACCEPT", "REJECT"].includes(action)) {
      return NextResponse.json(
        { error: "delegationId and action (ACCEPT|REJECT) are required" },
        { status: 400 }
      );
    }

    const delegation = await prisma.visitDelegation.findUnique({
      where: { id: delegationId },
      include: {
        visit: { select: { id: true, executiveId: true, visitNumber: true, status: true } },
        fromExecutive: { select: { id: true, name: true } },
      },
    });

    if (!delegation) {
      return NextResponse.json({ error: "Delegation not found" }, { status: 404 });
    }
    if (delegation.toExecutiveId !== user.userId) {
      return NextResponse.json({ error: "Not your delegation request" }, { status: 403 });
    }
    if (delegation.visitId !== visitId) {
      return NextResponse.json({ error: "Visit mismatch" }, { status: 400 });
    }
    if (delegation.status !== "PENDING") {
      return NextResponse.json({ error: "Delegation already resolved" }, { status: 409 });
    }

    if (action === "ACCEPT") {
      // 1. Transfer visit ownership
      await prisma.visit.update({
        where: { id: visitId },
        data: { executiveId: user.userId },
      });

      // 2. Mark delegation as ACCEPTED
      const updated = await prisma.visitDelegation.update({
        where: { id: delegationId },
        data: { status: "ACCEPTED" },
      });

      // 3. Auto-submit leave request for the from-executive
      const leaveDate = toMidnightUTC(new Date(delegation.leaveDate));
      const today     = toMidnightUTC(new Date());

      let leaveCreated = false;
      if (leaveDate > today) {
        // Only create if not duplicate
        const existing = await prisma.leaveRequest.findUnique({
          where: {
            executiveId_date: {
              executiveId: delegation.fromExecutiveId,
              date: leaveDate,
            },
          },
        });
        if (!existing) {
          await prisma.leaveRequest.create({
            data: {
              executiveId: delegation.fromExecutiveId,
              date: leaveDate,
              reason: delegation.leaveReason,
            },
          });
          leaveCreated = true;
        }
      }

      return NextResponse.json({
        delegation: updated,
        leaveCreated,
        message: `Visit transferred. ${leaveCreated ? "Leave request submitted for approval." : ""}`,
      });
    } else {
      // REJECT
      const updated = await prisma.visitDelegation.update({
        where: { id: delegationId },
        data: {
          status: "REJECTED",
          rejectionReason: rejectionReason?.trim() || "No reason provided",
        },
      });

      return NextResponse.json({
        delegation: updated,
        message: "Delegation rejected. The requesting executive has been notified.",
      });
    }
  } catch (error) {
    console.error("Delegation PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
