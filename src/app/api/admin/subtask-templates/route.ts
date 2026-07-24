import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/middleware";
import { isAdminRole } from "@/lib/auth/roles";
import { syncAfterTemplateChange } from "@/lib/utils/create-visit";

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const includeInactive = searchParams.get("includeInactive") === "true";
  const clientId = searchParams.get("clientId") || undefined;

  try {
    const templates = await prisma.subtaskTemplate.findMany({
      where: {
        ...(includeInactive ? {} : { isActive: true }),
        // If clientId is provided, return client-specific + global templates
        // If no clientId, return only global templates (clientId = null)
        ...(clientId
          ? { OR: [{ clientId }, { clientId: null }] }
          : { clientId: null }),
      },
      orderBy: [{ taskType: "asc" }, { orderIndex: "asc" }],
    });

    // Group by taskType — client-specific templates are marked
    const grouped = templates.reduce((acc, t) => {
      if (!acc[t.taskType]) acc[t.taskType] = [];
      acc[t.taskType].push(t);
      return acc;
    }, {} as Record<string, typeof templates>);

    return NextResponse.json({ templates, grouped });
  } catch (error) {
    console.error("Get templates error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await request.json();
    const { taskType, title, orderIndex, clientId } = body;

    if (!taskType?.trim() || !title?.trim())
      return NextResponse.json({ error: "taskType and title are required" }, { status: 400 });

    // Validate clientId exists if provided
    if (clientId) {
      const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
      if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    let idx = orderIndex;
    if (idx === undefined || idx === null) {
      const max = await prisma.subtaskTemplate.aggregate({
        where: { taskType, clientId: clientId ?? null },
        _max: { orderIndex: true },
      });
      idx = (max._max.orderIndex ?? 0) + 1;
    }

    const template = await prisma.subtaskTemplate.create({
      data: {
        taskType: taskType.trim(),
        title: title.trim(),
        orderIndex: idx,
        isActive: true,
        ...(clientId && { clientId }),
      },
    });

    await prisma.activityLog.create({
      data: {
        userId: user.userId,
        action: "SUBTASK_TEMPLATE_UPDATED",
        metadata: { action: "created", templateId: template.id, taskType, title: template.title, clientId: clientId ?? null },
      },
    });

    // Propagate immediately to already-scheduled PENDING visits
    await syncAfterTemplateChange(clientId ?? null);

    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    console.error("Create template error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
