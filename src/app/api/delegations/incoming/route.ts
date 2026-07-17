import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { prisma } from "@/lib/db/prisma";

// ─── GET /api/delegations/incoming ────────────────────────────────────────
// Returns all PENDING delegation requests directed at the current executive.
// Used by the leave page to show an "incoming requests" notification.
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "EXECUTIVE") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const incoming = await prisma.visitDelegation.findMany({
      where: { toExecutiveId: user.userId, status: "PENDING" },
      include: {
        fromExecutive: { select: { id: true, name: true } },
        visit: {
          select: {
            id: true,
            visitNumber: true,
            scheduledDate: true,
            client: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ incoming });
  } catch (error) {
    console.error("Incoming delegations GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
