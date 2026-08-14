import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/middleware";
import { isAdminRole } from "@/lib/auth/roles";

// ─── GET /api/admin/clients/[id]/assignment ──────────────────────────────────
// The assignment of the client's current (PENDING/OPEN) visit, used to prefill
// the Edit Client form. Admin / Super Admin only — executives never reach it.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  try {
    const visit = await prisma.visit.findFirst({
      where: { clientId: id, status: { in: ["PENDING", "OPEN"] } },
      orderBy: { scheduledDate: "asc" },
      select: {
        id: true,
        visitNumber: true,
        visitType: true,
        executive: { select: { id: true, name: true } },
        assignments: { select: { role: true, executive: { select: { id: true, name: true } } } },
      },
    });

    if (!visit) {
      // No active visit yet — fall back to the client's assigned executive.
      const client = await prisma.client.findUnique({
        where: { id },
        select: { assignedExec: { select: { id: true, name: true } } },
      });
      return NextResponse.json({
        assignment: {
          visitId: null,
          visitType: "SOLO" as const,
          teamLead: client?.assignedExec ?? null,
          teamMembers: [],
        },
      });
    }

    return NextResponse.json({
      assignment: {
        visitId: visit.id,
        visitNumber: visit.visitNumber,
        visitType: visit.visitType,
        teamLead: { id: visit.executive.id, name: visit.executive.name },
        teamMembers: visit.assignments
          .filter((a) => a.role !== "LEAD")
          .map((a) => ({ id: a.executive.id, name: a.executive.name })),
      },
    });
  } catch (error) {
    console.error("Get client assignment error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
