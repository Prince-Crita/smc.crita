/**
 * Utility: Auto-create a Visit with Tasks + Subtasks for a client–executive assignment.
 *
 * Called whenever:
 *   1. Admin creates a new Client with an assignedExecId
 *   2. Admin edits a Client and sets/changes the assignedExecId
 *
 * Visit number format: SMC-{CLIENT_CODE}-{YYYYMM}-{NNN}
 * e.g. SMC-CLIFF-202506-001
 *
 * The Visit row and its configured Tasks/Subtasks are written in ONE
 * transaction: a visit must never be committed without the task structure its
 * client's configuration calls for, because an executive then opens it and
 * finds nothing to do. Activity logging stays outside — a logging failure
 * must not roll back a visit that was created correctly.
 *
 * Task population order:
 *   1. Client-specific SubtaskTemplates (clientId = this client) — override global
 *   2. Global SubtaskTemplates (clientId = null) — fallback
 *   3. The 6 standard task types are always created even if no subtask templates exist
 *   4. Any additional custom task types that have client-specific templates are also created
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

/** The base client or a transaction client — both expose the models used here. */
type TaskScaffoldDb = PrismaClient | Prisma.TransactionClient;

// ─── Rule 2 marker: subtask-only carry-forward visit ───────────────────────
// Distinguishes the TWO carry-forward rules, which must stay independent:
//
//   Rule 1 - the client had NO visit at all during a week. The whole planned
//            visit moves to the next week WITH its full task structure
//            (checkAndCreateMissedWeeklyVisits → normal scaffolding).
//
//   Rule 2 - the client HAD a visit but some subtasks were missed. Only those
//            subtasks move to the next week (executeCarryForward →
//            skipTaskScaffolding). The visit deliberately holds nothing else.
//
// Without this marker the two rules bleed into each other: a Rule-2 visit is
// just another PENDING visit, so syncClientPendingVisits would scaffold the
// client's entire task configuration into it on the next task-config change,
// silently turning a 2-subtask carry-forward back into a full visit.
//
// Lives here (not in carry-forward.ts) purely to avoid an import cycle:
// carry-forward.ts already imports this module, and re-exports these two.
export const CARRY_FORWARD_SUBTASKS_ONLY_MARKER = "[CF-SUBTASKS-ONLY]";

/**
 * True for a Rule-2 visit: its task list must never be REBUILT from the
 * client's configuration (see syncClientPendingVisits), because replacing or
 * removing its tasks is exactly what would defeat subtask-level carry-forward.
 *
 * It does NOT mean the visit may never receive the client's configured work —
 * see ensureCarryForwardVisitHasClientTasks below for when it must.
 */
export function isSubtaskOnlyCarryForwardVisit(visit: { notes: string | null }): boolean {
  return !!visit.notes && visit.notes.includes(CARRY_FORWARD_SUBTASKS_ONLY_MARKER);
}

// ─── A carry-forward visit that stands in for the client's weekly visit ────
//
// A carry-forward-only visit is created ONLY when the client has nothing
// scheduled on the target day (executeCarryForward reuses the real visit
// whenever one exists, so the carried items sit alongside its normal task
// list). Automatic weekly generation is disabled, so nothing else will ever
// come along and create that client's visit for the week either.
//
// The result was a visit that looks like any other on the executive's list —
// same client, same date, assignable to a solo executive or a whole team —
// but that contains only the handful of subtasks carried over, with the
// client's configured main tasks and subtasks missing entirely. If the
// carried items were later completed, rejected or removed by an admin, the
// visit was left as an empty shell with nothing to do at all.
//
// So: when a carry-forward-only visit is the client's ONLY visit that week it
// is not a supplement to a real visit — it IS the client's visit, and the
// executives sent to it must be given the client's configured work. When the
// client does have another visit that week, the configured work lives there
// and this one correctly stays a pure carry-forward container.
//
// Everything below is purely ADDITIVE. No carried subtask, no completed
// subtask and no task is ever renamed, reordered, replaced or deleted by it.

/**
 * Title prefix a carried subtask wears so an executive can see where it came
 * from. Matched here so a carried item and the template line it came from are
 * recognised as the SAME checklist entry and scaffolding never stacks a
 * duplicate twin on top of it.
 */
export const CARRY_FORWARD_TITLE_PREFIX = "[CARRY-FORWARD] ";

const cleanSubtaskTitle = (title: string) =>
  title.replace(CARRY_FORWARD_TITLE_PREFIX, "").trim().toLowerCase();

/** Monday 00:00 UTC of the week containing `d` — the app's week boundary. */
function mondayOfWeekUTC(d: Date): Date {
  const monday = new Date(d);
  const dow = monday.getUTCDay(); // 0 = Sunday
  monday.setUTCDate(monday.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}

/** True when the client has no OTHER visit in the same week as this one. */
async function isClientsOnlyVisitInItsWeek(visit: {
  id: string;
  clientId: string;
  scheduledDate: Date;
}): Promise<boolean> {
  const weekStart = mondayOfWeekUTC(visit.scheduledDate);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  const others = await prisma.visit.count({
    where: {
      clientId: visit.clientId,
      id: { not: visit.id },
      scheduledDate: { gte: weekStart, lt: weekEnd },
    },
  });
  return others === 0;
}

export interface ScaffoldResult {
  tasksAdded: number;
  subtasksAdded: number;
}

const NOTHING_ADDED: ScaffoldResult = { tasksAdded: 0, subtasksAdded: 0 };

/**
 * Add the client's configured main tasks and template subtasks to an EXISTING
 * visit, leaving everything already on it exactly as it is.
 *
 * A template subtask is skipped when its task already holds a subtask with the
 * same title, with or without the carry-forward prefix, so a carried item
 * never gains a duplicate twin. Tasks already present are left untouched —
 * their title, order, subtasks and progress are not rewritten here.
 *
 * Constant number of queries regardless of how many tasks are added.
 */
export async function addMissingConfiguredTasks(visitId: string): Promise<ScaffoldResult> {
  const visit = await prisma.visit.findUnique({
    where: { id: visitId },
    select: {
      id: true,
      clientId: true,
      status: true,
      tasks: { select: { id: true, taskType: true, subtasks: { select: { title: true } } } },
    },
  });
  // Closed visits are completed history and keep the tasks they closed with.
  if (!visit || visit.status === "CLOSED") return NOTHING_ADDED;

  const plan = await resolveClientTaskPlan(visit.clientId);
  if (plan.length === 0) return NOTHING_ADDED;

  const existingTypes = new Set(visit.tasks.map((t) => t.taskType));
  const missingTasks = plan.filter((entry) => !existingTypes.has(entry.type));

  if (missingTasks.length > 0) {
    await prisma.task.createMany({
      data: missingTasks.map((entry) => ({
        visitId,
        taskType: entry.type,
        title: entry.title,
        status: "PENDING" as const,
        orderIndex: entry.orderIndex,
      })),
    });
  }

  // Re-read only when new tasks were created — otherwise the ids and titles
  // already loaded above are current.
  const tasks = missingTasks.length
    ? await prisma.task.findMany({
        where: { visitId },
        select: { id: true, taskType: true, subtasks: { select: { title: true } } },
      })
    : visit.tasks;
  const taskByType = new Map(tasks.map((t) => [t.taskType, t]));

  const subtaskRows: { taskId: string; title: string; isCompleted: boolean; isCarriedForward: boolean }[] = [];
  for (const entry of plan) {
    const task = taskByType.get(entry.type);
    if (!task) continue;
    const present = new Set(task.subtasks.map((s) => cleanSubtaskTitle(s.title)));
    for (const title of entry.subtaskTitles) {
      const key = cleanSubtaskTitle(title);
      if (present.has(key)) continue; // already there (carried or scaffolded)
      present.add(key);
      subtaskRows.push({ taskId: task.id, title, isCompleted: false, isCarriedForward: false });
    }
  }

  if (subtaskRows.length > 0) {
    await prisma.subtask.createMany({ data: subtaskRows });
  }

  return { tasksAdded: missingTasks.length, subtasksAdded: subtaskRows.length };
}

/**
 * Give a carry-forward-only visit the client's configured tasks, but ONLY when
 * it is standing in for the client's visit that week (see the note above).
 *
 * Called by every flow that creates a carry-forward-only visit, after the
 * carried subtasks have been placed on it — so the carried rows are already
 * present and the title de-duplication above can see them.
 */
export async function ensureCarryForwardVisitHasClientTasks(visitId: string): Promise<ScaffoldResult> {
  const visit = await prisma.visit.findUnique({
    where: { id: visitId },
    select: { id: true, clientId: true, scheduledDate: true, notes: true, status: true },
  });
  if (!visit || visit.status === "CLOSED") return NOTHING_ADDED;
  if (!isSubtaskOnlyCarryForwardVisit(visit)) return NOTHING_ADDED;
  if (!(await isClientsOnlyVisitInItsWeek(visit))) return NOTHING_ADDED;
  return addMissingConfiguredTasks(visitId);
}

/**
 * THE GUARANTEE: a visit an executive has been assigned to carries the
 * client's configured work.
 *
 * Call this from every path that assigns or re-assigns a visit to somebody.
 * Handing an executive a visit is the moment it becomes real work, and it is
 * the last point at which a missing task list can still be caught before they
 * are standing in front of the client with nothing to do.
 *
 * Why a visit can reach that point with tasks missing: a carry-forward
 * destination visit only ever gets the main tasks its CARRIED items need, and
 * it gets them empty — `approveCarryForward` and `executeCarryForward` create
 * a task on demand purely to hold a carried subtask. If those carried subtasks
 * are later removed (admin → Carry Forward → remove), the tasks stay behind as
 * empty shells and the client's configured task types that had no carried item
 * were never created at all. Nothing then back-fills them: the full
 * configuration sync (syncClientPendingVisits) runs only when an admin edits
 * Task Configuration, which may never happen again for that client.
 *
 * Purely ADDITIVE — see addMissingConfiguredTasks. Existing tasks, subtasks,
 * completion, carried items and progress are never renamed, reordered,
 * replaced or deleted.
 *
 * Rule 2 is preserved: a carry-forward-ONLY visit still goes through the
 * narrower gate above, so a visit that exists purely to hold carried subtasks
 * alongside the client's real visit stays exactly that.
 */
export async function ensureVisitHasConfiguredTasks(visitId: string): Promise<ScaffoldResult> {
  const visit = await prisma.visit.findUnique({
    where: { id: visitId },
    select: { id: true, notes: true, status: true },
  });
  // Closed visits are completed history — they keep what they closed with.
  if (!visit || visit.status === "CLOSED") return NOTHING_ADDED;

  return isSubtaskOnlyCarryForwardVisit(visit)
    ? ensureCarryForwardVisitHasClientTasks(visitId)
    : addMissingConfiguredTasks(visitId);
}

// ─── Default task type definitions ────────────────────────────────────────────

export const DEFAULT_TASK_TYPES = [
  { type: "OPERATIONAL_VERIFICATION", title: "Operational Verification", orderIndex: 0 },
  { type: "STOCK_VERIFICATION",       title: "Stock Verification",       orderIndex: 1 },
  { type: "AVF_REPORT",               title: "AVF Report",               orderIndex: 2 },
  { type: "ACCOUNTS_VERIFICATION",    title: "Accounts Verification",    orderIndex: 3 },
  { type: "MR_MONTHLY_REPORT",        title: "MR Monthly Report",        orderIndex: 4 },
  { type: "MD_MEETING",               title: "MD Meeting",               orderIndex: 5 },
];

export const DEFAULT_TASK_TYPE_SET: Set<string> = new Set(DEFAULT_TASK_TYPES.map((t) => t.type));

/** Convert a human-readable title to a SCREAMING_SNAKE_CASE task type key */
export function titleToTaskType(title: string): string {
  return title.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/** Convert a task type key to a human-readable title */
export function taskTypeToTitle(taskType: string): string {
  const def = DEFAULT_TASK_TYPES.find((t) => t.type === taskType);
  if (def) return def.title;
  return taskType
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Task plan resolution ──────────────────────────────────────────────────────

export interface TaskPlanEntry {
  type: string;
  title: string;
  orderIndex: number;
  /** Subtask titles resolved from templates (client-specific > global). */
  subtaskTitles: string[];
}

/**
 * Resolve the client's CURRENT effective task configuration:
 *   - the 6 default task types, minus per-client soft-deletes, with
 *     per-client renames and ordering applied (ClientTaskType)
 *   - plus custom task types registered for the client
 *   - each with its subtask templates (client-specific override > global)
 *
 * Used by createVisitForClient (new visits) AND syncClientPendingVisits
 * (propagating admin config changes to already-scheduled PENDING visits).
 */
export async function resolveClientTaskPlan(clientId: string): Promise<TaskPlanEntry[]> {
  const [clientTemplates, globalTemplates, taskTypeConfigs] = await Promise.all([
    prisma.subtaskTemplate.findMany({
      where: { clientId, isActive: true },
      orderBy: [{ taskType: "asc" }, { orderIndex: "asc" }],
    }),
    prisma.subtaskTemplate.findMany({
      where: { clientId: null, isActive: true },
      orderBy: [{ taskType: "asc" }, { orderIndex: "asc" }],
    }),
    prisma.clientTaskType.findMany({ where: { clientId } }),
  ]);

  const clientTaskTypeSet = new Set(clientTemplates.map((t) => t.taskType));
  const configByType = new Map(taskTypeConfigs.map((c) => [c.taskType, c]));

  // Custom task types = explicitly registered via ClientTaskType, plus
  // (legacy) client-specific template types that are NOT in the 6 defaults.
  const customTaskTypes = [
    ...new Set([
      ...taskTypeConfigs.filter((c) => !DEFAULT_TASK_TYPE_SET.has(c.taskType) && !c.isDeleted).map((c) => c.taskType),
      ...[...clientTaskTypeSet].filter((tt) => !DEFAULT_TASK_TYPE_SET.has(tt)),
    ]),
  ].filter((tt) => !configByType.get(tt)?.isDeleted);

  const resolveSubtaskTitles = (taskType: string): string[] => {
    const source = clientTaskTypeSet.has(taskType)
      ? clientTemplates.filter((t) => t.taskType === taskType)
      : globalTemplates.filter((t) => t.taskType === taskType);
    return source.map((t) => t.title);
  };

  return [
    ...DEFAULT_TASK_TYPES
      .filter((d) => !configByType.get(d.type)?.isDeleted)
      .map((d) => {
        const cfg = configByType.get(d.type);
        return {
          type: d.type,
          title: cfg?.title ?? d.title,
          orderIndex: cfg?.orderIndex ?? d.orderIndex,
        };
      }),
    ...customTaskTypes.map((type, i) => {
      const cfg = configByType.get(type);
      return {
        type,
        title: cfg?.title ?? taskTypeToTitle(type),
        orderIndex: cfg?.orderIndex ?? DEFAULT_TASK_TYPES.length + i,
      };
    }),
  ]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    // Re-normalize orderIndex so Task rows are always 0..n-1 without gaps
    .map((t, i) => ({ ...t, orderIndex: i, subtaskTitles: resolveSubtaskTitles(t.type) }));
}

/**
 * Batch-scaffold tasks + subtasks for a visit from a resolved task plan.
 * Exactly 3 DB round-trips regardless of task count:
 *   1. task.createMany, 2. fetch created task ids, 3. subtask.createMany.
 *
 * Pass `db` to run inside a caller's transaction, so the visit and its
 * configured task structure are committed together or not at all.
 */
export async function createTasksWithSubtasks(
  visitId: string,
  plan: TaskPlanEntry[],
  db: TaskScaffoldDb = prisma
): Promise<void> {
  if (plan.length === 0) return;

  await db.task.createMany({
    data: plan.map((entry) => ({
      visitId,
      taskType: entry.type,
      title: entry.title,
      status: "PENDING" as const,
      orderIndex: entry.orderIndex,
    })),
  });

  const created = await db.task.findMany({
    where: { visitId },
    select: { id: true, taskType: true },
  });
  const idByType = new Map(created.map((t) => [t.taskType, t.id]));

  const subtaskRows = plan.flatMap((entry) => {
    const taskId = idByType.get(entry.type);
    if (!taskId) return [];
    return entry.subtaskTitles.map((title) => ({
      taskId,
      title,
      isCompleted: false,
      isCarriedForward: false,
    }));
  });

  if (subtaskRows.length > 0) {
    await db.subtask.createMany({ data: subtaskRows });
  }
}

// ─── Sync config changes to already-scheduled PENDING visits ──────────────────

/**
 * Propagates the client's CURRENT task configuration to every ACTIVE
 * (PENDING or OPEN) visit of that client, so admin changes in Task
 * Configuration are immediately visible to executives - including on the
 * visit they are currently working on - without waiting for the next visit
 * to be scaffolded.
 *
 * Safety rules (never destroy real work):
 *   - CLOSED visits are history - they keep the tasks they were closed with.
 *   - Carried-forward subtasks (isCarriedForward) are ALWAYS preserved.
 *   - Completed subtasks are ALWAYS preserved.
 *   - Subtasks the executive already touched (an incompletion reason typed)
 *     are ALWAYS preserved - only pristine template copies are replaced.
 *   - Tasks containing any protected subtask are never deleted, even if the
 *     task type was removed from the client's config.
 */
export async function syncClientPendingVisits(clientId: string): Promise<{ visitsSynced: number }> {
  const [plan, pendingVisits] = await Promise.all([
    resolveClientTaskPlan(clientId),
    prisma.visit.findMany({
      where: { clientId, status: { in: ["PENDING", "OPEN"] } },
      include: { tasks: { include: { subtasks: true } } },
    }),
  ]);

  const planByType = new Map(plan.map((p) => [p.type, p]));

  for (const visit of pendingVisits) {
    // Rule-2 carry-forward visits hold the subtasks that were missed the
    // previous week. The full sync below REBUILDS a visit from the client's
    // configuration — replacing template subtasks and deleting tasks whose
    // type was removed — and running that against a carry-forward visit would
    // defeat subtask-level carry-forward entirely. So they never take that
    // path.
    //
    // They do still need the client's configured work when they are standing
    // in for the client's visit that week; that path adds what is missing and
    // removes nothing, so every carried row survives untouched.
    if (isSubtaskOnlyCarryForwardVisit(visit)) {
      await ensureCarryForwardVisitHasClientTasks(visit.id);
      continue;
    }

    const existingByType = new Map(visit.tasks.map((t) => [t.taskType, t]));

    // 1. Ensure every planned task exists with the current title/order/subtasks
    for (const entry of plan) {
      const existing = existingByType.get(entry.type);

      if (!existing) {
        const task = await prisma.task.create({
          data: {
            visitId: visit.id,
            taskType: entry.type,
            title: entry.title,
            status: "PENDING",
            orderIndex: entry.orderIndex,
          },
        });
        if (entry.subtaskTitles.length > 0) {
          await prisma.subtask.createMany({
            data: entry.subtaskTitles.map((title) => ({
              taskId: task.id,
              title,
              isCompleted: false,
              isCarriedForward: false,
            })),
          });
        }
        continue;
      }

      // Rename / reorder if changed
      if (existing.title !== entry.title || existing.orderIndex !== entry.orderIndex) {
        await prisma.task.update({
          where: { id: existing.id },
          data: { title: entry.title, orderIndex: entry.orderIndex },
        });
      }

      // Re-sync template-derived subtasks. Preserve carried-forward,
      // completed, and executive-touched (incompletion reason) subtasks;
      // only the plain, untouched template copies are replaced - and only
      // when the template set actually changed.
      const isProtected = (s: { isCarriedForward: boolean; isCompleted: boolean; incompletionReason: string | null }) =>
        s.isCarriedForward || s.isCompleted || !!s.incompletionReason?.trim();
      const preserved = existing.subtasks.filter(isProtected);
      const replaceable = existing.subtasks.filter((s) => !isProtected(s));
      const currentTitles = replaceable.map((s) => s.title);
      const wantedTitles = entry.subtaskTitles;
      const unchanged =
        currentTitles.length === wantedTitles.length &&
        currentTitles.every((t, i) => t === wantedTitles[i]);

      if (!unchanged) {
        if (replaceable.length > 0) {
          await prisma.subtask.deleteMany({
            where: { id: { in: replaceable.map((s) => s.id) } },
          });
        }
        if (wantedTitles.length > 0) {
          await prisma.subtask.createMany({
            data: wantedTitles.map((title) => ({
              taskId: existing.id,
              title,
              isCompleted: false,
              isCarriedForward: false,
            })),
          });
        }
      }
      void preserved; // carried/completed rows are simply left untouched
    }

    // 2. Remove tasks whose type is no longer in the client's config -
    //    but never if they contain completed or carried-forward work.
    for (const task of visit.tasks) {
      if (planByType.has(task.taskType)) continue;
      const hasProtectedWork = task.subtasks.some(
        (s) => s.isCompleted || s.isCarriedForward || !!s.incompletionReason?.trim()
      );
      if (hasProtectedWork) continue;
      await prisma.task.delete({ where: { id: task.id } }); // cascades to subtasks
    }
  }

  return { visitsSynced: pendingVisits.length };
}

/**
 * After any task-configuration change, propagate the new configuration to
 * already-scheduled PENDING visits so executives see it immediately.
 * clientId=null (a GLOBAL template changed) → every client with a pending
 * visit is re-synced (their plan resolution decides whether the global
 * change actually applies).
 * Failures are logged, never thrown - a sync problem must not fail the
 * admin's save.
 */
export async function syncAfterTemplateChange(clientId: string | null): Promise<void> {
  try {
    if (clientId) {
      await syncClientPendingVisits(clientId);
      return;
    }
    const rows = await prisma.visit.findMany({
      where: { status: "PENDING" },
      select: { clientId: true },
      distinct: ["clientId"],
    });
    for (const row of rows) {
      await syncClientPendingVisits(row.clientId);
    }
  } catch (err) {
    console.error("[task-config-sync] failed to sync pending visits:", err);
  }
}

// ─── Main function ─────────────────────────────────────────────────────────────

export interface CreateVisitForClientOptions {
  /** Defaults to now(). Lets carry-forward flows schedule on a specific date/time. */
  scheduledDate?: Date;
  /** End of the visit's working window (defaults to null — see Visit.endDate doc). */
  endDate?: Date;
  /** Stored verbatim on the created Visit (e.g. a carry-forward marker). */
  notes?: string;
  /**
   * By default this function returns an existing PENDING/OPEN visit instead
   * of creating a duplicate. Carry-forward flows (e.g. the "Missed Weekly
   * Visit" check) need to create a genuinely new visit for a specific
   * missed week even if the client already has some other unrelated active
   * visit, and rely on their OWN idempotency check (the notes marker)
   * instead of this guard. Set true to bypass it.
   */
  skipActiveDuplicateGuard?: boolean;
  /**
   * Create the Visit row WITHOUT scaffolding the client's task configuration
   * (no main tasks, no template subtasks) — an intentionally empty visit.
   *
   * Used only by subtask-level carry-forward: that visit must contain ONLY
   * the incomplete subtasks being carried over, grouped under the main tasks
   * they came from. Scaffolding the full plan here is what made carry-forward
   * appear to duplicate the whole visit (every main task and every completed
   * subtask reappeared the following week).
   *
   * Every other caller (new client, repeat visit, missed-weekly) must leave
   * this false so a normal visit still gets its full task list.
   */
  skipTaskScaffolding?: boolean;
}

export async function createVisitForClient(
  clientId: string,
  executiveId: string,
  adminUserId: string,
  options: CreateVisitForClientOptions = {}
): Promise<{ visitId: string; visitNumber: string }> {
  const { scheduledDate, endDate, notes, skipActiveDuplicateGuard, skipTaskScaffolding } = options;

  // ── Guard: don't create duplicate pending/open visits ────────────────────
  if (!skipActiveDuplicateGuard) {
    const existingPending = await prisma.visit.findFirst({
      where: {
        clientId,
        executiveId,
        status: { in: ["PENDING", "OPEN"] },
      },
      select: { id: true, visitNumber: true },
    });
    if (existingPending) {
      // Already has an active visit — return it without creating a duplicate
      return { visitId: existingPending.id, visitNumber: existingPending.visitNumber };
    }
  }

  // ── Get client info for visit number generation ──────────────────────────
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { code: true, name: true },
  });
  if (!client) throw new Error(`Client not found: ${clientId}`);

  // ── Generate unique visit number ─────────────────────────────────────────
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `SMC-${client.code}-${yearMonth}`;

  const lastVisit = await prisma.visit.findFirst({
    where: { visitNumber: { startsWith: prefix } },
    orderBy: { visitNumber: "desc" },
    select: { visitNumber: true },
  });

  let seq = 1;
  if (lastVisit) {
    const parts = lastVisit.visitNumber.split("-");
    const lastSeq = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }
  const visitNumber = `${prefix}-${String(seq).padStart(3, "0")}`;

  // ── Resolve the client's effective task plan (config + templates) ────────
  // Skipped entirely for a carry-forward-only visit, which must start empty.
  const orderedTaskTypes = skipTaskScaffolding ? [] : await resolveClientTaskPlan(clientId);

  // ── STEPS 1 + 2: the Visit and its configured Tasks/Subtasks, atomically ──
  // One transaction, so a failure while scaffolding can never leave a visit
  // behind with no tasks on it — the state that makes an executive open a
  // visit and find the client's configured work missing.
  //
  // Tasks and subtasks are batched (createMany + one fetch + one createMany)
  // rather than one task.create + one subtask.createMany per task type, which
  // keeps client creation / duplication / repeat visits fast on serverless +
  // remote Postgres.
  const visit = await prisma.$transaction(async (tx) => {
    const created = await tx.visit.create({
      data: {
        visitNumber,
        clientId,
        executiveId,
        status:        "PENDING",
        scheduledDate: scheduledDate ?? now,
        endDate:       endDate ?? null,
        notes:         notes ?? null,
      },
    });
    await createTasksWithSubtasks(created.id, orderedTaskTypes, tx);
    return created;
  });

  // ── STEP 3: Log activity ─────────────────────────────────────────────────
  await prisma.activityLog.create({
    data: {
      visitId: visit.id,
      userId:  adminUserId,
      action:  "VISIT_CREATED",
      metadata: {
        visitNumber,
        clientId,
        clientName: client.name,
        executiveId,
        taskCount: orderedTaskTypes.length,
      },
    },
  });

  return { visitId: visit.id, visitNumber: visit.visitNumber };
}
