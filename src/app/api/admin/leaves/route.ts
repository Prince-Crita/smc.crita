import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { prisma } from "@/lib/db/prisma";

// ─── GET /api/admin/leaves ─────────────────────────────────────────────────
// Query params: status (PENDING | APPROVED | REJECTED | all)
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get("status") ?? "PENDING";

    const leaves = await prisma.leaveRequest.findMany({
      where: statusParam !== "all" ? { status: statusParam as "PENDING" | "APPROVED" | "REJECTED" } : {},
      include: {
        executive: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { name: true } },
      },
      orderBy: [{ status: "asc" }, { date: "asc" }],
    });

    return NextResponse.json({ leaves });
  } catch (error) {
    console.error("Admin leaves GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
