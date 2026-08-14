import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/middleware";
import { isAdminRole } from "@/lib/auth/roles";
import { createVisitForClient } from "@/lib/utils/create-visit";
import { applyAssignment, normalizeAssignment } from "@/lib/utils/visit-assignment";


export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const showArchived = searchParams.get("archived") === "true";

  try {
    const clients = await prisma.client.findMany({
      where: { isArchived: showArchived },
      select: {
        id: true,
        name: true,
        code: true,
        contactPerson: true,
        address: true,
        phone: true,
        email: true,
        reportEmails: true,
        assignedExecId: true,
        startDate: true,
        endDate: true,
        isArchived: true,
        createdAt: true,
        assignedExec: { select: { id: true, name: true, email: true } },
        // Use _count to get visitCount without loading visit rows
        _count: { select: { visits: true } },
        // Fetch only the most recent visit — date, status and its MD Meeting
        // answer (used for the "Closed without MD Meeting" badge - P6)
        visits: {
          select: {
            scheduledDate: true,
            status: true,
            tasks: {
              where: { taskType: "MD_MEETING" },
              select: { mdMeetingAnswer: true },
            },
          },
          orderBy: { scheduledDate: "desc" },
          take: 1,
        },
      },
      orderBy: { name: "asc" },
    });


    const result = clients.map((c: any) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      contactPerson: c.contactPerson,
      address: c.address,
      phone: c.phone,
      email: c.email,
      reportEmails: c.reportEmails,
      assignedExecId: c.assignedExecId,
      assignedExec: c.assignedExec,
      startDate: c.startDate,
      endDate: c.endDate,
      isArchived: c.isArchived,
      createdAt: c.createdAt,
      visitCount: c._count.visits,          // from aggregate — no row loading
      recentVisitDate: c.visits[0]?.scheduledDate ?? null,
      // P6: MD Meeting workflow status of the latest visit
      //   "NO_MEETING" → latest visit CLOSED with MD answer NO
      //   "PENDING"    → latest visit not closed and MD answer not given yet
      //   null         → nothing to flag
      mdMeetingStatus:
        c.visits[0]?.tasks?.[0]
          ? c.visits[0].status === "CLOSED" && c.visits[0].tasks[0].mdMeetingAnswer === "NO"
            ? "NO_MEETING"
            : c.visits[0].status !== "CLOSED" && !c.visits[0].tasks[0].mdMeetingAnswer
            ? "PENDING"
            : null
          : null,
    }));


    return NextResponse.json({ clients: result });
  } catch (error) {
    console.error("Get clients error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await request.json();
    const { name, code, contactPerson, address, phone, email, reportEmails, assignedExecId, startDate, endDate } = body;

    if (!name?.trim()) return NextResponse.json({ error: "Client name is required" }, { status: 400 });
    if (!code?.trim()) return NextResponse.json({ error: "Client code is required" }, { status: 400 });
    if (!contactPerson?.trim()) return NextResponse.json({ error: "Contact person is required" }, { status: 400 });
    if (!address?.trim()) return NextResponse.json({ error: "Address is required" }, { status: 400 });

    const existing = await prisma.client.findUnique({ where: { code: code.toUpperCase().trim() } });
    if (existing) return NextResponse.json({ error: "Client code already exists" }, { status: 409 });

    const client = await prisma.client.create({
      data: {
        name: name.trim(),
        code: code.toUpperCase().trim(),
        contactPerson: contactPerson.trim(),
        address: address.trim(),
        phone: phone || null,
        email: email || null,
        reportEmails: Array.isArray(reportEmails) ? reportEmails : [],
        assignedExecId: assignedExecId || null,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
      },
      include: { assignedExec: { select: { id: true, name: true, email: true } } },
    });

    await prisma.activityLog.create({
      data: { userId: user.userId, action: "CLIENT_ADDED", metadata: { clientName: client.name, clientCode: client.code, addedBy: user.name } },
    });

    // Auto-create a Visit so the executive can work on it immediately.
    // We surface any failure as a warning rather than silently ignoring it.
    let visitInfo = null;
    let visitError: string | null = null;
    if (assignedExecId) {
      try {
        visitInfo = await createVisitForClient(client.id, assignedExecId, user.userId, {
          scheduledDate: client.startDate ?? undefined,
          endDate: client.endDate ?? undefined,
        });

        // Apply the Solo/Team assignment chosen in Add Client to that visit.
        // Solo needs nothing extra — the executive is already the visit owner.
        if (visitInfo?.visitId && body.visitType === "TEAM") {
          const normalized = normalizeAssignment(
            { visitType: "TEAM", executiveId: assignedExecId, memberIds: body.memberIds },
            assignedExecId
          );
          if (normalized.error) visitError = normalized.error;
          else await applyAssignment(prisma, visitInfo.visitId, normalized.value);
        }
      } catch (visitErr) {
        console.error("[create-visit] Failed to auto-create visit after client creation:", visitErr);
        visitError = visitErr instanceof Error ? visitErr.message : String(visitErr);
      }
    }

    return NextResponse.json(
      { client, visitCreated: visitInfo, ...(visitError && { visitWarning: visitError }) },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create client error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
