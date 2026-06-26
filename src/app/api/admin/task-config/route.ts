/**
 * GET /api/admin/task-config
 * Returns all clients with their task configuration summary.
 * Used by the Task Config page client-list view.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/middleware";

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const [clients, templateCounts] = await Promise.all([
      prisma.client.findMany({
        where: { isArchived: false },
        select: {
          id: true,
          name: true,
          code: true,
          assignedExec: { select: { id: true, name: true } },
        },
        orderBy: { name: "asc" },
      }),
      prisma.subtaskTemplate.groupBy({
        by: ["clientId"],
        where: { isActive: true },
        _count: { id: true },
      }),
    ]);

    // Build a clientId → subtask count map
    const countMap = new Map<string | null, number>();
    for (const row of templateCounts) {
      countMap.set(row.clientId, row._count.id);
    }

    const result = clients.map((c) => ({
      ...c,
      clientSubtaskCount: countMap.get(c.id) ?? 0,   // client-specific templates
      globalSubtaskCount: countMap.get(null) ?? 0,    // global templates (shown as fallback)
    }));

    return NextResponse.json({ clients: result });
  } catch (error) {
    console.error("Get task-config clients error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
