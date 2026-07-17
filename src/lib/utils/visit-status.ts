/**
 * Centralized visit display-status calculation.
 *
 * The database `visit.status` field (PENDING / OPEN / CLOSED) is the source of
 * truth for whether a visit has been formally closed by the executive/admin.
 * `displayStatus` mirrors that truth everywhere in the UI:
 *   - visit.status === "CLOSED"                    -> "CLOSED"   (always - even if
 *     some subtasks were incomplete and carried forward, e.g. 83% complete)
 *   - visit.status !== "CLOSED" and 0 completed     -> "PENDING"
 *   - visit.status !== "CLOSED" and 1+ completed    -> "IN_PROGRESS"
 *
 * The subtask completion percentage is reported separately via `progress` /
 * `calculateProgress` and is never used to override an explicit Closed status.
 * A visit closed at 83% must show "Closed" everywhere while still showing
 * "83% Complete" - those are two independent pieces of information.
 *
 * Use `calculateDisplayStatus` / `getSubtaskTotals` everywhere in the UI and
 * API response payloads instead of re-deriving status ad hoc.
 */

export type DisplayStatus = "PENDING" | "IN_PROGRESS" | "CLOSED";

/**
 * Calculate the user-facing display status.
 * @param completedSubtasks - number of completed subtasks
 * @param totalSubtasks     - total number of subtasks
 * @param dbStatus          - the visit's actual DB workflow status (PENDING / OPEN / CLOSED).
 *                            When "CLOSED", this always wins regardless of subtask completion.
 */
export function calculateDisplayStatus(
  completedSubtasks: number,
  totalSubtasks: number,
  dbStatus?: string
): DisplayStatus {
  if (dbStatus === "CLOSED") return "CLOSED";
  if (totalSubtasks === 0 || completedSubtasks === 0) return "PENDING";
  const progress = (completedSubtasks / totalSubtasks) * 100;
  if (progress >= 100) return "CLOSED";
  return "IN_PROGRESS";
}

/**
 * Calculate integer progress percentage (0-100) from subtask counts.
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
 * @param tasks    - visit's tasks with subtasks
 * @param dbStatus - the visit's actual DB workflow status (PENDING / OPEN / CLOSED).
 *                   Pass this whenever available so displayStatus reflects a
 *                   formally closed visit regardless of subtask completion %.
 */
export function getSubtaskTotals(
  tasks: { subtasks: { isCompleted: boolean; isCarriedForward: boolean }[] }[],
  dbStatus?: string
): {
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
  const displayStatus = calculateDisplayStatus(completedSubtasks, totalSubtasks, dbStatus);

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
