import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { isAdminRole } from "@/lib/auth/roles";
import { prisma } from "@/lib/db/prisma";

// ─── PATCH /api/leaves/[id] ── Admin: approve or reject ────────────────────
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const body = await request.json() as { action: "approve" | "reject"; comment?: string };
    const { action, comment } = body;

    if (!action || !["approve", "reject"].includes(action)) {
      return NextResponse.json({ error: "Action must be 'approve' or 'reject'" }, { status: 400 });
    }

    const leave = await prisma.leaveRequest.findUnique({ where: { id } });
    if (!leave) {
      return NextResponse.json({ error: "Leave request not found" }, { status: 404 });
    }
    if (leave.status !== "PENDING") {
      return NextResponse.json({ error: "This request has already been reviewed" }, { status: 409 });
    }

    const updated = await prisma.leaveRequest.update({
      where: { id },
      data: {
        status: action === "approve" ? "APPROVED" : "REJECTED",
        adminComment: comment?.trim() || null,
        reviewedById: user.userId,
        reviewedAt: new Date(),
      },
      include: {
        executive: { select: { name: true, email: true } },
      },
    });

    return NextResponse.json({ leave: updated });
  } catch (error) {
    console.error("Leave PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
