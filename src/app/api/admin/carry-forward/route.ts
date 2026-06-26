import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { prisma } from "@/lib/db/prisma";

// GET /api/admin/carry-forward — All carry-forward activity
//
// OPTIMIZATION: Replaced deep nested include chains with flat select statements.
// Previous version loaded entire visit, task, and client objects at each level.
// Now we select only the exact scalar fields needed for the response.
// Also runs the two DB queries in parallel via Promise.all.
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // Run both queries in parallel — no dependency between them
    const [carriedSubtasks, cfLogs] = await Promise.all([
      prisma.subtask.findMany({
        where: { isCarriedForward: true },
        select: {
          id: true,
          title: true,
          isCompleted: true,
          task: {
            select: {
              title: true,
              taskType: true,
              visitId: true,
              visit: {
                select: {
                  visitNumber: true,
                  status: true,
                  scheduledDate: true,
                  client: { select: { name: true, code: true } },
                  executive: { select: { name: true } },
                },
              },
            },
          },
          // Only need these 3 scalar fields from the source visit
          sourceSubtask: {
            select: {
              task: {
                select: {
                  visit: {
                    select: {
                      visitNumber: true,
                      closedAt: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),

      prisma.activityLog.findMany({
        where: { action: "CARRY_FORWARD_APPLIED" },
        select: {
          id: true,
          createdAt: true,
          metadata: true,
          user: { select: { name: true } },
          visit: {
            select: {
              visitNumber: true,
              client: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 100, // Cap logs — no need for unbounded query
      }),
    ]);

    // Group carried subtasks by destination visit — O(n) single pass
    const byVisit = new Map<string, typeof carriedSubtasks>();
    for (const subtask of carriedSubtasks) {
      const visitId = subtask.task.visitId;
      if (!byVisit.has(visitId)) byVisit.set(visitId, []);
      byVisit.get(visitId)!.push(subtask);
    }

    const grouped = Array.from(byVisit.entries()).map(([visitId, subtasks]) => ({
      visitId,
      visitNumber: subtasks[0].task.visit.visitNumber,
      clientName: subtasks[0].task.visit.client.name,
      clientCode: subtasks[0].task.visit.client.code,
      executiveName: subtasks[0].task.visit.executive.name,
      visitStatus: subtasks[0].task.visit.status,
      scheduledDate: subtasks[0].task.visit.scheduledDate,
      carriedItems: subtasks.map((s) => ({
        id: s.id,
        title: s.title,
        taskTitle: s.task.title,
        taskType: s.task.taskType,
        isCompleted: s.isCompleted,
        sourceVisitNumber: s.sourceSubtask?.task.visit.visitNumber || "N/A",
        sourceClosedAt: s.sourceSubtask?.task.visit.closedAt || null,
      })),
    }));

    return NextResponse.json({ carryForwards: grouped, logs: cfLogs });
  } catch (error) {
    console.error("Carry forward error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
