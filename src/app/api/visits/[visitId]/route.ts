import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { prisma } from "@/lib/db/prisma";

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

    // Executive can only see their own visits
    if (user.role === "EXECUTIVE" && visit.executiveId !== user.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Calculate progress
    const totalSubtasks = visit.tasks.reduce((sum, t) => sum + t.subtasks.length, 0);
    const completedSubtasks = visit.tasks.reduce(
      (sum, t) => sum + t.subtasks.filter((s) => s.isCompleted).length,
      0
    );
    const progress = totalSubtasks === 0 ? 0 : Math.round((completedSubtasks / totalSubtasks) * 100);

    return NextResponse.json({ visit: { ...visit, progress, totalSubtasks, completedSubtasks } });
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
    const visit = await prisma.visit.findUnique({ where: { id: visitId } });
    if (!visit) return NextResponse.json({ error: "Visit not found" }, { status: 404 });

    if (visit.executiveId !== user.userId) {
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
