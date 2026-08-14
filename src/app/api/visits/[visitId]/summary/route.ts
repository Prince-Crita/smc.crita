import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { prisma } from "@/lib/db/prisma";
import { canViewVisit } from "@/lib/utils/visit-access";

// GET /api/visits/[visitId]/summary
export async function GET(request: NextRequest, { params }: { params: Promise<{ visitId: string }> }) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { visitId } = await params;

  try {
    const visit = await prisma.visit.findUnique({
      where: { id: visitId },
      select: {
        id: true,
        visitNumber: true,
        status: true,
        summaryJson: true,
        executiveId: true,
        client: { select: { name: true, code: true } },
        executive: { select: { name: true } },
        assignments: { select: { executiveId: true, role: true } },
      },
    });

    if (!visit) return NextResponse.json({ error: "Visit not found" }, { status: 404 });

    // The whole team may read the summary of a visit they worked on.
    if (user.role === "EXECUTIVE" && !canViewVisit(visit, user.userId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!visit.summaryJson) {
      return NextResponse.json({ error: "Summary not yet generated" }, { status: 404 });
    }

    return NextResponse.json({ summary: visit.summaryJson });
  } catch (error) {
    console.error("Get summary error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
