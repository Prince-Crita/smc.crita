import { Task, Subtask, Visit, Client } from "@prisma/client";

interface SubtaskData extends Subtask {}
interface TaskData extends Task {
  subtasks: SubtaskData[];
}
interface ExecutiveData {
  id: string;
  name: string;
  email: string;
}
export interface VisitData extends Visit {
  client: Client;
  executive: ExecutiveData;
  tasks: TaskData[];
}


export interface VisitSummary {
  visitNumber: string;
  clientName: string;
  clientCode: string;
  executiveName: string;
  scheduledDate: string;
  openedAt: string | null;
  closedAt: string;
  duration: string;
  totalTasks: number;
  completedTasks: number;
  partialTasks: number;
  pendingTasks: number;
  totalSubtasks: number;
  completedSubtasks: number;
  incompleteSubtasks: number;
  carryForwardCount: number;
  completionPercentage: number;
  mdMeetingHeld: boolean;
  mdMeetingAnswer: string;
  taskBreakdown: {
    taskType: string;
    title: string;
    status: string;
    completedSubtasks: number;
    totalSubtasks: number;
    incompleteItems: { title: string; reason: string }[];
  }[];
  keyFindings: string[];
  overallRating: "Excellent" | "Satisfactory" | "Needs Improvement" | "Unsatisfactory";
}

function formatDuration(startDate: Date, endDate: Date): string {
  const diffMs = endDate.getTime() - startDate.getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function determineOverallRating(percentage: number, carryForwardCount: number): VisitSummary["overallRating"] {
  if (percentage === 100) return "Excellent";
  if (percentage >= 80 && carryForwardCount <= 2) return "Satisfactory";
  if (percentage >= 60) return "Needs Improvement";
  return "Unsatisfactory";
}

function generateKeyFindings(tasks: TaskData[]): string[] {
  const findings: string[] = [];

  for (const task of tasks) {
    const completed = task.subtasks.filter((s) => s.isCompleted).length;
    const total = task.subtasks.length;
    const incomplete = task.subtasks.filter((s) => !s.isCompleted);

    if (completed === total) {
      findings.push(`${task.title}: All ${total} items verified and completed successfully.`);
    } else if (incomplete.length > 0) {
      findings.push(
        `${task.title}: ${completed}/${total} items completed. ${incomplete.length} item(s) carried forward.`
      );
    }

    if (task.taskType === "MD_MEETING") {
      findings.push(
        `MD Meeting: ${task.mdMeetingAnswer === "YES" ? "Meeting held and confirmed by MD." : "MD was unavailable; meeting not conducted."}`
      );
    }
  }

  return findings;
}

export function generateVisitSummary(visit: VisitData, carryForwardCount: number): VisitSummary {
  const closedAt = new Date();
  const openedAt = visit.openedAt;

  let completedTasks = 0;
  let partialTasks = 0;
  let pendingTasks = 0;
  let totalSubtasks = 0;
  let completedSubtasks = 0;
  let mdMeetingAnswer = "N/A";

  const taskBreakdown = visit.tasks.map((task) => {
    const taskCompleted = task.subtasks.filter((s) => s.isCompleted).length;
    const taskTotal = task.subtasks.length;
    const incompleteItems = task.subtasks
      .filter((s) => !s.isCompleted)
      .map((s) => ({ title: s.title, reason: s.incompletionReason || "No reason provided" }));

    totalSubtasks += taskTotal;
    completedSubtasks += taskCompleted;

    if (taskCompleted === taskTotal) {
      completedTasks++;
    } else if (taskCompleted > 0) {
      partialTasks++;
    } else {
      pendingTasks++;
    }

    if (task.taskType === "MD_MEETING" && task.mdMeetingAnswer) {
      mdMeetingAnswer = task.mdMeetingAnswer;
    }

    return {
      taskType: task.taskType,
      title: task.title,
      status: taskCompleted === taskTotal ? "COMPLETED" : taskCompleted > 0 ? "PARTIALLY_COMPLETED" : "PENDING",
      completedSubtasks: taskCompleted,
      totalSubtasks: taskTotal,
      incompleteItems,
    };
  });

  const completionPercentage = totalSubtasks === 0 ? 0 : Math.round((completedSubtasks / totalSubtasks) * 100);
  const overallRating = determineOverallRating(completionPercentage, carryForwardCount);
  const keyFindings = generateKeyFindings(visit.tasks);

  return {
    visitNumber: visit.visitNumber,
    clientName: visit.client.name,
    clientCode: visit.client.code,
    executiveName: visit.executive.name,
    scheduledDate: visit.scheduledDate.toISOString(),
    openedAt: openedAt?.toISOString() || null,
    closedAt: closedAt.toISOString(),
    duration: openedAt ? formatDuration(openedAt, closedAt) : "Unknown",
    totalTasks: visit.tasks.length,
    completedTasks,
    partialTasks,
    pendingTasks,
    totalSubtasks,
    completedSubtasks,
    incompleteSubtasks: totalSubtasks - completedSubtasks,
    carryForwardCount,
    completionPercentage,
    mdMeetingHeld: mdMeetingAnswer === "YES",
    mdMeetingAnswer,
    taskBreakdown,
    keyFindings,
    overallRating,
  };
}
