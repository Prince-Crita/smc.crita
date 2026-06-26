import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/middleware";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  try {
    const body = await request.json();
    const { title, orderIndex, isActive } = body;

    const template = await prisma.subtaskTemplate.update({
      where: { id },
      data: {
        ...(title && { title: title.trim() }),
        ...(orderIndex !== undefined && { orderIndex }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    await prisma.activityLog.create({
      data: { userId: user.userId, action: "SUBTASK_TEMPLATE_UPDATED", metadata: { action: "updated", templateId: id, taskType: template.taskType } },
    });

    return NextResponse.json({ template });
  } catch (error) {
    console.error("Update template error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  try {
    const template = await prisma.subtaskTemplate.findUnique({ where: { id } });
    if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

    await prisma.subtaskTemplate.delete({ where: { id } });

    await prisma.activityLog.create({
      data: { userId: user.userId, action: "SUBTASK_TEMPLATE_UPDATED", metadata: { action: "deleted", templateId: id, taskType: template.taskType, title: template.title } },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete template error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
