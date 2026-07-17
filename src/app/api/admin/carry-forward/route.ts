import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { prisma } from "@/lib/db/prisma";
import { CARRY_FORWARD_NOTE_PREFIX, runCarryForwardMaintenance } from "@/lib/utils/carry-forward";

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
    // Generate any carry-forwards that became due (end date passed) before
    // reading, so the page always shows the current truth immediately.
    await runCarryForwardMaintenance();

    // Run all queries in parallel — no dependency between them
    const [carriedSubtasks, cfLogs, missedWeekVisits] = await Promise.all([
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

      // Visit-level carry-forwards (Business Rule 2 — "Missed Weekly Visit")
      // that have no carried SUBTASKS of their own (fresh subtasks were
      // scaffolded for the new visit). These are invisible to the
      // subtask-grouping query above, so fetch them separately by the
      // shared notes marker.
      prisma.visit.findMany({
        where: { notes: { contains: CARRY_FORWARD_NOTE_PREFIX } },
        select: {
          id: true,
          visitNumber: true,
          status: true,
          scheduledDate: true,
          notes: true,
          client: { select: { name: true, code: true } },
          executive: { select: { name: true } },
        },
        orderBy: { scheduledDate: "desc" },
      }),
    ]);

    // Group carried subtasks by destination visit — O(n) single pass
    const byVisit = new Map<string, typeof carriedSubtasks>();
    for (const subtask of carriedSubtasks) {
      const visitId = subtask.task.visitId;
      if (!byVisit.has(visitId)) byVisit.set(visitId, []);
      byVisit.get(visitId)!.push(subtask);
    }

    // Destination visits' full task lists - the planning UI needs them so
    // the admin can add new subtasks to any main task of the next visit.
    const destVisitIds = [
      ...new Set([...byVisit.keys(), ...missedWeekVisits.map((v) => v.id)]),
    ];
    const destTasks = destVisitIds.length > 0
      ? await prisma.task.findMany({
          where: { visitId: { in: destVisitIds } },
          select: { id: true, visitId: true, taskType: true, title: true },
          orderBy: { orderIndex: "asc" },
        })
      : [];
    const tasksByVisit = new Map<string, { id: string; taskType: string; title: string }[]>();
    for (const t of destTasks) {
      if (!tasksByVisit.has(t.visitId)) tasksByVisit.set(t.visitId, []);
      tasksByVisit.get(t.visitId)!.push({ id: t.id, taskType: t.taskType, title: t.title });
    }

    const grouped = Array.from(byVisit.entries()).map(([visitId, subtasks]) => ({
      visitId,
      visitNumber: subtasks[0].task.visit.visitNumber,
      clientName: subtasks[0].task.visit.client.name,
      clientCode: subtasks[0].task.visit.client.code,
      executiveName: subtasks[0].task.visit.executive.name,
      visitStatus: subtasks[0].task.visit.status,
      scheduledDate: subtasks[0].task.visit.scheduledDate,
      reason: null as string | null,
      visitTasks: tasksByVisit.get(visitId) ?? [],
      carriedItems: subtasks.map((s: any) => ({
        id: s.id,
        title: s.title,
        taskTitle: s.task.title,
        taskType: s.task.taskType,
        isCompleted: s.isCompleted,
        sourceVisitNumber: s.sourceSubtask?.task.visit.visitNumber || "N/A",
        sourceClosedAt: s.sourceSubtask?.task.visit.closedAt || null,
      })),
    }));

    // Append visit-level-only carry-forwards (no carried subtasks yet) that
    // aren't already represented above, so "Missed Weekly Visit" carries
    // show up in this history view too.
    for (const v of missedWeekVisits) {
      if (byVisit.has(v.id)) continue;
      grouped.push({
        visitId: v.id,
        visitNumber: v.visitNumber,
        clientName: v.client.name,
        clientCode: v.client.code,
        executiveName: v.executive.name,
        visitStatus: v.status,
        scheduledDate: v.scheduledDate,
        reason: "Missed Weekly Visit",
        visitTasks: tasksByVisit.get(v.id) ?? [],
        carriedItems: [],
      });
    }

    grouped.sort((a, b) => new Date(b.scheduledDate).getTime() - new Date(a.scheduledDate).getTime());

    return NextResponse.json({ carryForwards: grouped, logs: cfLogs });
  } catch (error) {
    console.error("Carry forward error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── DELETE /api/admin/carry-forward?subtaskId=... ───────────────────────────
// Planning action: remove a carried-forward subtask from the next visit.
// Only carried, not-yet-completed subtasks on non-closed visits can be
// removed - completed work and closed history are never touched.
export async function DELETE(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const subtaskId = searchParams.get("subtaskId");
  if (!subtaskId) return NextResponse.json({ error: "subtaskId is required" }, { status: 400 });

  try {
    const subtask = await prisma.subtask.findUnique({
      where: { id: subtaskId },
      select: {
        id: true,
        title: true,
        isCompleted: true,
        isCarriedForward: true,
        task: { select: { visitId: true, title: true, visit: { select: { status: true, visitNumber: true } } } },
      },
    });
    if (!subtask) return NextResponse.json({ error: "Subtask not found" }, { status: 404 });
    if (!subtask.isCarriedForward)
      return NextResponse.json({ error: "Only carry-forward subtasks can be removed here" }, { status: 400 });
    if (subtask.isCompleted)
      return NextResponse.json({ error: "Cannot remove a completed subtask" }, { status: 400 });
    if (subtask.task.visit.status === "CLOSED")
      return NextResponse.json({ error: "Cannot modify a closed visit" }, { status: 400 });

    await prisma.subtask.delete({ where: { id: subtaskId } });

    await prisma.activityLog.create({
      data: {
        visitId: subtask.task.visitId,
        userId: user.userId,
        action: "SUBTASK_TEMPLATE_UPDATED",
        metadata: {
          action: "carry_forward_removed",
          subtaskTitle: subtask.title,
          taskTitle: subtask.task.title,
          visitNumber: subtask.task.visit.visitNumber,
          removedBy: user.name,
        },
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Carry forward remove error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST /api/admin/carry-forward ───────────────────────────────────────────
// Planning action: add a new subtask to a main task of the next visit.
// Body: { taskId: string, title: string }
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { taskId, title } = body as { taskId?: string; title?: string };
    if (!taskId || !title?.trim())
      return NextResponse.json({ error: "taskId and title are required" }, { status: 400 });

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, title: true, visitId: true, visit: { select: { status: true, visitNumber: true } } },
    });
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    if (task.visit.status === "CLOSED")
      return NextResponse.json({ error: "Cannot modify a closed visit" }, { status: 400 });

    const subtask = await prisma.subtask.create({
      data: {
        taskId: task.id,
        title: title.trim(),
        isCompleted: false,
        isCarriedForward: false, // a fresh planned task, not a carried one
      },
    });

    await prisma.activityLog.create({
      data: {
        visitId: task.visitId,
        userId: user.userId,
        action: "SUBTASK_TEMPLATE_UPDATED",
        metadata: {
          action: "planning_task_added",
          subtaskTitle: subtask.title,
          taskTitle: task.title,
          visitNumber: task.visit.visitNumber,
          addedBy: user.name,
        },
      },
    });

    return NextResponse.json({ subtask }, { status: 201 });
  } catch (error) {
    console.error("Carry forward add-task error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
