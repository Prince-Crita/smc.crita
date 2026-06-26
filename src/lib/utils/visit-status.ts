/**
 * Centralized visit display-status calculation.
 *
 * IMPORTANT: The database `visit.status` field (PENDING / OPEN / CLOSED) tracks
 * the *workflow state* — whether the executive has opened or formally closed the visit.
 * It does NOT represent task completion percentage.
 *
 * The *display status* shown to users is derived purely from subtask progress:
 *   - 0% completed subtasks     → "PENDING"
 *   - 1–99% completed subtasks  → "IN_PROGRESS"
 *   - 100% completed subtasks   → "CLOSED"
 *
 * A visit with visit.status = "CLOSED" in the DB but only 80% subtask completion
 * (because some subtasks were incomplete and carried forward) should display as
 * "IN_PROGRESS", not "Closed".
 *
 * Use `calculateDisplayStatus` everywhere in the UI and API response payloads.
 * Never expose the raw DB status field as the user-facing status.
 */

export type DisplayStatus = "PENDING" | "IN_PROGRESS" | "CLOSED";

/**
 * Calculate the progress-based display status from subtask counts.
 * @param completedSubtasks - number of completed subtasks
 * @param totalSubtasks     - total number of subtasks
 */
export function calculateDisplayStatus(
  completedSubtasks: number,
  totalSubtasks: number
): DisplayStatus {
  if (totalSubtasks === 0 || completedSubtasks === 0) return "PENDING";
  const progress = (completedSubtasks / totalSubtasks) * 100;
  if (progress >= 100) return "CLOSED";
  return "IN_PROGRESS";
}

/**
 * Calculate integer progress percentage (0–100) from subtask counts.
 */
export function calculateProgress(
  completedSubtasks: number,
  totalSubtasks: number
): number {
  if (totalSubtasks === 0) return 0;
  return Math.round((completedSubtasks / totalSubtasks) * 100);
}

/**
 * Get subtask totals from a task array (the shape returned by Prisma includes).
 */
export function getSubtaskTotals(tasks: { subtasks: { isCompleted: boolean; isCarriedForward: boolean }[] }[]): {
  totalSubtasks: number;
  completedSubtasks: number;
  carryForwardCount: number;
  progress: number;
  displayStatus: DisplayStatus;
} {
  const totalSubtasks = tasks.reduce((s, t) => s + t.subtasks.length, 0);
  const completedSubtasks = tasks.reduce(
    (s, t) => s + t.subtasks.filter((st) => st.isCompleted).length,
    0
  );
  const carryForwardCount = tasks.reduce(
    (s, t) => s + t.subtasks.filter((st) => st.isCarriedForward).length,
    0
  );
  const progress = calculateProgress(completedSubtasks, totalSubtasks);
  const displayStatus = calculateDisplayStatus(completedSubtasks, totalSubtasks);

  return { totalSubtasks, completedSubtasks, carryForwardCount, progress, displayStatus };
}

/**
 * Human-readable label for a display status.
 */
export const DISPLAY_STATUS_LABELS: Record<DisplayStatus, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In Progress",
  CLOSED: "Closed",
};
