import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { prisma } from "@/lib/db/prisma";
import { canViewVisit, canWorkVisit, canCloseVisit } from "@/lib/utils/visit-access";

// GET /api/visits/[visitId] - Get single visit with all tasks and subtasks
export async function GET(request: NextRequest, { params }: { params: Promise<{ visitId: string }> }) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { visitId } = await params;

  try {
    const visit = await prisma.visit.findUnique({
      where: { id: visitId },
      include: {
        // Select only the client fields consumed by the visit detail UI.
        // Previously `include: { client: true }` over-fetched reportEmails,
        // assignedExecId, isArchived, updatedAt, etc. — all unused here.
        client: {
          select: {
            name: true,
            code: true,
            contactPerson: true,
            address: true,
            phone: true,
          },
        },
        executive: { select: { id: true, name: true, email: true } },
        assignments: {
          select: { executiveId: true, role: true, executive: { select: { id: true, name: true } } },
        },
        tasks: {
          include: {
            subtasks: {
              orderBy: [{ isCarriedForward: "asc" }, { createdAt: "asc" }],
            },
          },
          orderBy: { orderIndex: "asc" },
        },
        activityLogs: {
          include: {
            user: { select: { name: true, role: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        },
      },
    });


    if (!visit) {
      return NextResponse.json({ error: "Visit not found" }, { status: 404 });
    }

    // Executives see their own visits AND the team visits they are on.
    if (user.role === "EXECUTIVE" && !canViewVisit(visit, user.userId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Calculate progress
    const totalSubtasks = visit.tasks.reduce((sum, t) => sum + t.subtasks.length, 0);
    const completedSubtasks = visit.tasks.reduce(
      (sum, t) => sum + t.subtasks.filter((s) => s.isCompleted).length,
      0
    );
    const progress = totalSubtasks === 0 ? 0 : Math.round((completedSubtasks / totalSubtasks) * 100);

    // `canClose` drives whether the executive's visit page offers the Close
    // button. The close endpoint enforces the same rule server-side, so hiding
    // the button is presentation only, never the security boundary.
    return NextResponse.json({
      visit: {
        ...visit,
        progress,
        totalSubtasks,
        completedSubtasks,
        isTeamVisit: visit.visitType === "TEAM",
        canClose: canCloseVisit(visit, user.userId),
        teamLead: { id: visit.executive.id, name: visit.executive.name },
        teamMembers: visit.assignments
          .filter((a) => a.role !== "LEAD")
          .map((a) => ({ id: a.executiveId, name: a.executive.name })),
      },
    });
  } catch (error) {
    console.error("Get visit error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/visits/[visitId] - Open a visit
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ visitId: string }> }) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "EXECUTIVE") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { visitId } = await params;

  try {
    const visit = await prisma.visit.findUnique({
      where: { id: visitId },
      include: { assignments: { select: { executiveId: true, role: true } } },
    });
    if (!visit) return NextResponse.json({ error: "Visit not found" }, { status: 404 });

    // Any executive on the visit may open it — a team member arriving first
    // must be able to start work without waiting for the lead. Closing stays
    // lead-only.
    if (!canWorkVisit(visit, user.userId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (visit.status !== "PENDING") {
      return NextResponse.json({ error: "Visit is already open or closed" }, { status: 400 });
    }

    const updatedVisit = await prisma.visit.update({
      where: { id: visitId },
      data: { status: "OPEN", openedAt: new Date() },
    });

    await prisma.activityLog.create({
      data: {
        visitId,
        userId: user.userId,
        action: "VISIT_OPENED",
        metadata: { visitNumber: visit.visitNumber, executiveName: user.name },
      },
    });

    return NextResponse.json({ visit: updatedVisit });
  } catch (error) {
    console.error("Open visit error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
