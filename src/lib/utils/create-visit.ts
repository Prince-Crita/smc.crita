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
 * IMPORTANT: Does NOT use prisma.$transaction(callback) because the PrismaPg
 * driver adapter (wrapping pg.Pool) can have compatibility issues with
 * interactive transactions. Uses plain sequential awaited writes instead,
 * which are fully supported by all Prisma Driver Adapters.
 *
 * Task population order:
 *   1. Client-specific SubtaskTemplates (clientId = this client) — override global
 *   2. Global SubtaskTemplates (clientId = null) — fallback
 *   3. The 6 standard task types are always created even if no subtask templates exist
 *   4. Any additional custom task types that have client-specific templates are also created
 */

import { prisma } from "@/lib/db/prisma";

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
 */
export async function createTasksWithSubtasks(visitId: string, plan: TaskPlanEntry[]): Promise<void> {
  if (plan.length === 0) return;

  await prisma.task.createMany({
    data: plan.map((entry) => ({
      visitId,
      taskType: entry.type,
      title: entry.title,
      status: "PENDING" as const,
      orderIndex: entry.orderIndex,
    })),
  });

  const created = await prisma.task.findMany({
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
    await prisma.subtask.createMany({ data: subtaskRows });
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
}

export async function createVisitForClient(
  clientId: string,
  executiveId: string,
  adminUserId: string,
  options: CreateVisitForClientOptions = {}
): Promise<{ visitId: string; visitNumber: string }> {
  const { scheduledDate, endDate, notes, skipActiveDuplicateGuard } = options;

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
  const orderedTaskTypes = await resolveClientTaskPlan(clientId);

  // ── STEP 1: Create the Visit record ─────────────────────────────────────
  // Plain write — no transaction wrapper — fully compatible with all Prisma adapters.
  const visit = await prisma.visit.create({
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

  // ── STEP 2: Create Tasks and Subtasks (batched - 3 queries total) ────────
  // Previously one task.create + one subtask.createMany PER task type
  // (2N round-trips to the DB). Batched into createMany + one fetch + one
  // createMany, which makes client creation / duplication / repeat visits
  // noticeably faster on serverless + remote Postgres.
  await createTasksWithSubtasks(visit.id, orderedTaskTypes);

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
