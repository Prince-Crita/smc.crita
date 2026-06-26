import { prisma } from "@/lib/db/prisma";
import { Task, Subtask, Visit } from "@prisma/client";

interface TaskWithSubtasks extends Task {
  subtasks: Subtask[];
}

interface VisitWithTasks extends Visit {
  tasks: TaskWithSubtasks[];
}

/**
 * Calculate progress percentage for a visit based on completed subtasks
 */
export function calculateProgress(tasks: TaskWithSubtasks[]): {
  percentage: number;
  completedSubtasks: number;
  totalSubtasks: number;
  completedTasks: number;
  totalTasks: number;
} {
  let completedSubtasks = 0;
  let totalSubtasks = 0;
  let completedTasks = 0;

  for (const task of tasks) {
    const taskTotal = task.subtasks.length;
    const taskCompleted = task.subtasks.filter((s) => s.isCompleted).length;

    totalSubtasks += taskTotal;
    completedSubtasks += taskCompleted;

    if (taskCompleted === taskTotal && taskTotal > 0) {
      completedTasks++;
    }
  }

  const percentage = totalSubtasks === 0 ? 0 : Math.round((completedSubtasks / totalSubtasks) * 100);

  return {
    percentage,
    completedSubtasks,
    totalSubtasks,
    completedTasks,
    totalTasks: tasks.length,
  };
}

/**
 * Validate that a visit can be closed
 * Returns array of blocking errors
 */
export function validateVisitClose(visit: VisitWithTasks): string[] {
  const errors: string[] = [];

  for (const task of visit.tasks) {
    // Check MD Meeting confirmation
    if (task.taskType === "MD_MEETING" && !task.mdMeetingAnswer) {
      errors.push("MD Meeting confirmation (YES/NO) is mandatory before closing the visit.");
    }

    // Check incomplete subtasks have reasons
    for (const subtask of task.subtasks) {
      if (!subtask.isCompleted && !subtask.incompletionReason?.trim()) {
        errors.push(
          `Task "${task.title}" has incomplete subtask "${subtask.title}" without a reason. Please provide a reason for all incomplete items.`
        );
      }
    }
  }

  return errors;
}

/**
 * Execute carry-forward logic when a visit is closed
 * Finds next visit for the same client and carries incomplete subtasks forward
 */
export async function executeCarryForward(
  closedVisit: VisitWithTasks,
  closedByUserId: string
): Promise<{ carriedCount: number; nextVisitId: string | null }> {
  // Find all incomplete subtasks
  const incompleteSubtasks: { subtask: Subtask; task: Task }[] = [];
  for (const task of closedVisit.tasks) {
    for (const subtask of task.subtasks) {
      if (!subtask.isCompleted) {
        incompleteSubtasks.push({ subtask, task });
      }
    }
  }

  if (incompleteSubtasks.length === 0) {
    return { carriedCount: 0, nextVisitId: null };
  }

  // Find the next pending/upcoming visit for the same client
  const nextVisit = await prisma.visit.findFirst({
    where: {
      clientId: closedVisit.clientId,
      status: { in: ["PENDING", "OPEN"] },
      scheduledDate: { gt: closedVisit.scheduledDate },
    },
    orderBy: { scheduledDate: "asc" },
    include: {
      tasks: {
        include: { subtasks: true },
      },
    },
  });

  if (!nextVisit) {
    return { carriedCount: incompleteSubtasks.length, nextVisitId: null };
  }

  // Group incomplete subtasks by task type
  const byTaskType = new Map<string, { subtask: Subtask; task: Task }[]>();
  for (const item of incompleteSubtasks) {
    const key = item.task.taskType;
    if (!byTaskType.has(key)) byTaskType.set(key, []);
    byTaskType.get(key)!.push(item);
  }

  // For each task type with incomplete subtasks, find matching task in next visit and add subtasks
  let carriedCount = 0;
  const nextVisitWithTasks = nextVisit as typeof nextVisit & { tasks: TaskWithSubtasks[] };

  for (const [taskType, items] of byTaskType.entries()) {
    const matchingTask = nextVisitWithTasks.tasks.find((t) => t.taskType === taskType);
    if (!matchingTask) continue;

    for (const { subtask } of items) {
      await prisma.subtask.create({
        data: {
          taskId: matchingTask.id,
          title: `[CARRY-FORWARD] ${subtask.title}`,
          isCompleted: false,
          isCarriedForward: true,
          sourceSubtaskId: subtask.id,
        },
      });
      carriedCount++;
    }
  }

  // Log carry-forward activity
  await prisma.activityLog.create({
    data: {
      visitId: nextVisit.id,
      userId: closedByUserId,
      action: "CARRY_FORWARD_APPLIED",
      metadata: {
        fromVisitId: closedVisit.id,
        fromVisitNumber: closedVisit.visitNumber,
        toVisitId: nextVisit.id,
        toVisitNumber: nextVisit.visitNumber,
        carriedCount,
        items: incompleteSubtasks.map((i) => ({
          taskType: i.task.taskType,
          subtaskTitle: i.subtask.title,
          reason: i.subtask.incompletionReason,
        })),
      },
    },
  });

  return { carriedCount, nextVisitId: nextVisit.id };
}
