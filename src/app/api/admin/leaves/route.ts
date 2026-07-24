import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { isAdminRole } from "@/lib/auth/roles";
import { prisma } from "@/lib/db/prisma";

// ─── GET /api/admin/leaves ─────────────────────────────────────────────────
// Query params: status (PENDING | APPROVED | REJECTED | all), month (YYYY-MM, optional)
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get("status") ?? "PENDING";
    const monthParam = searchParams.get("month"); // YYYY-MM

    let dateFilter: { gte: Date; lt: Date } | undefined;
    if (monthParam) {
      const [year, month] = monthParam.split("-").map(Number);
      const start = new Date(Date.UTC(year, month - 1, 1));
      const end = new Date(Date.UTC(year, month, 1));
      dateFilter = { gte: start, lt: end };
    }

    const leaves = await prisma.leaveRequest.findMany({
      where: {
        ...(statusParam !== "all" ? { status: statusParam as "PENDING" | "APPROVED" | "REJECTED" } : {}),
        ...(dateFilter ? { date: dateFilter } : {}),
      },
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
