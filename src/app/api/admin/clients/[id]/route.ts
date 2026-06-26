import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/middleware";
import { createVisitForClient } from "@/lib/utils/create-visit";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  try {
    const client = await prisma.client.findUnique({
      where: { id },
      include: {
        assignedExec: { select: { id: true, name: true, email: true } },
        visits: {
          include: {
            executive: { select: { id: true, name: true } },
            tasks: { include: { subtasks: { select: { isCompleted: true } } } },
          },
          orderBy: { scheduledDate: "desc" },
        },
      },
    });

    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    const visits = client.visits.map((v) => {
      const total = v.tasks.reduce((s, t) => s + t.subtasks.length, 0);
      const done = v.tasks.reduce((s, t) => s + t.subtasks.filter((st) => st.isCompleted).length, 0);
      const progress = total === 0 ? 0 : Math.round((done / total) * 100);
      return { id: v.id, visitNumber: v.visitNumber, executive: v.executive, status: v.status, scheduledDate: v.scheduledDate, closedAt: v.closedAt, progress };
    });

    return NextResponse.json({ client: { ...client, visits } });
  } catch (error) {
    console.error("Get client error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  try {
    const body = await request.json();
    const { name, contactPerson, address, phone, email, reportEmails, assignedExecId, startDate, endDate, isArchived } = body;

    const existing = await prisma.client.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    // Detect if the executive assignment is changing
    const prevExecId = existing.assignedExecId;
    const newExecId = assignedExecId !== undefined ? (assignedExecId || null) : prevExecId;
    const execChanged = assignedExecId !== undefined && newExecId !== prevExecId;
    const execAssigned = execChanged && !!newExecId;

    const updated = await prisma.client.update({
      where: { id },
      data: {
        ...(name && { name: name.trim() }),
        ...(contactPerson && { contactPerson: contactPerson.trim() }),
        ...(address && { address: address.trim() }),
        ...(phone !== undefined && { phone: phone || null }),
        ...(email !== undefined && { email: email || null }),
        ...(reportEmails !== undefined && { reportEmails: Array.isArray(reportEmails) ? reportEmails : [] }),
        ...(assignedExecId !== undefined && { assignedExecId: assignedExecId || null }),
        ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
        ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
        ...(isArchived !== undefined && { isArchived }),
      },
      include: { assignedExec: { select: { id: true, name: true, email: true } } },
    });

    const wasArchived = isArchived === true && !existing.isArchived;
    await prisma.activityLog.create({
      data: {
        userId: user.userId,
        action: wasArchived ? "CLIENT_ARCHIVED" : "CLIENT_UPDATED",
        metadata: {
          clientId: id,
          clientName: updated.name,
          updatedBy: user.name,
          ...(execChanged && { prevExecId, newExecId }),
        },
      },
    });

    // If a new executive was just assigned, auto-create a Visit for them
    let visitInfo = null;
    let visitError: string | null = null;
    if (execAssigned) {
      try {
        visitInfo = await createVisitForClient(id, newExecId!, user.userId);
      } catch (visitErr) {
        console.error("[create-visit] Failed to auto-create visit after exec assignment:", visitErr);
        visitError = visitErr instanceof Error ? visitErr.message : String(visitErr);
      }
    }

    return NextResponse.json({
      client: updated,
      visitCreated: visitInfo,
      ...(visitError && { visitWarning: visitError }),
    });
  } catch (error) {
    console.error("Update client error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
