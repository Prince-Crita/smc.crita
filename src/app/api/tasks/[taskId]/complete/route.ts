import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { prisma } from "@/lib/db/prisma";
import { completeSubtasksSchema } from "@/lib/validations/task";

// PATCH /api/tasks/[taskId]/complete - Save subtask completion state
// NOTE: This endpoint saves whatever state the frontend sends.
// Validation that incomplete subtasks have reasons is enforced ONLY at close-visit time.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "EXECUTIVE") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { taskId } = await params;

  try {
    const body = await request.json();
    const result = completeSubtasksSchema.safeParse(body);

    if (!result.success) {
      console.error("Task save validation error:", result.error.flatten());
      return NextResponse.json(
        { error: "Invalid request format", details: result.error.flatten() },
        { status: 400 }
      );
    }

    const { subtasks, mdMeetingAnswer } = result.data;

    // Verify the task belongs to a visit assigned to this executive
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        visit: { select: { executiveId: true, status: true, visitNumber: true } },
        subtasks: true,
      },
    });

    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    if (task.visit.executiveId !== user.userId)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (task.visit.status !== "OPEN") {
      return NextResponse.json({ error: "Visit must be open to update tasks" }, { status: 400 });
    }

    // Verify all submitted subtask IDs belong to this task
    const validSubtaskIds = new Set(task.subtasks.map((s) => s.id));
    const invalidIds = subtasks.filter((s) => !validSubtaskIds.has(s.id));
    if (invalidIds.length > 0) {
      return NextResponse.json({ error: "Invalid subtask IDs" }, { status: 400 });
    }

    // Update each subtask — save state as-is, no reason enforcement here
    await Promise.all(
      subtasks.map((subtaskUpdate) =>
        prisma.subtask.update({
          where: { id: subtaskUpdate.id },
          data: {
            isCompleted: subtaskUpdate.isCompleted,
            // Clear reason if completed; keep/set reason if incomplete
            incompletionReason: subtaskUpdate.isCompleted
              ? null
              : (subtaskUpdate.incompletionReason ?? null),
            completedAt: subtaskUpdate.isCompleted ? new Date() : null,
          },
        })
      )
    );

    // Update MD Meeting answer if provided (and this is an MD_MEETING task)
    if (task.taskType === "MD_MEETING" && mdMeetingAnswer) {
      await prisma.task.update({
        where: { id: taskId },
        data: { mdMeetingAnswer },
      });
    }

    // Recalculate task status from the submitted state — no extra DB round-trip.
    // We already have the complete, validated subtask state from the request body.
    // The only edge case (a subtask that wasn't included in the request) is
    // handled by also including the pre-fetched task.subtasks from line 37.
    const totalCount = task.subtasks.length;
    const completedIds = new Set(
      subtasks.filter((s) => s.isCompleted).map((s) => s.id)
    );
    // For subtasks NOT in the update payload, use their current DB state
    const completedCount = task.subtasks.filter((s) =>
      completedIds.has(s.id)
        ? true                // updated to completed in this request
        : !subtasks.some((u) => u.id === s.id) && s.isCompleted // unchanged
    ).length;

    // Simpler path: all subtasks are always included in the payload
    const submittedCompletedCount = subtasks.filter((s) => s.isCompleted).length;
    const submittedTotal = subtasks.length;
    const effectiveCompleted = submittedTotal === totalCount
      ? submittedCompletedCount   // All subtasks submitted — use directly
      : completedCount;           // Partial submission — use merged count

    let taskStatus: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "PARTIALLY_COMPLETED" = "PENDING";
    if (effectiveCompleted === totalCount && totalCount > 0) {
      taskStatus = "COMPLETED";
    } else if (effectiveCompleted > 0) {
      taskStatus = "IN_PROGRESS";
    }

    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: {
        status: taskStatus,
        completedAt: taskStatus === "COMPLETED" ? new Date() : null,
      },
      // Return updated subtasks for the response payload
      include: { subtasks: true },
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        visitId: task.visitId,
        userId: user.userId,
        action: taskStatus === "COMPLETED" ? "TASK_COMPLETED" : "TASK_STARTED",
        metadata: {
          taskId,
          taskTitle: task.title,
          taskType: task.taskType,
          completedSubtasks: completedCount,
          totalSubtasks: totalCount,
          mdMeetingAnswer: mdMeetingAnswer || null,
        },
      },
    });

    return NextResponse.json({ task: updatedTask });
  } catch (error) {
    console.error("Complete task error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
