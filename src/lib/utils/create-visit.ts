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

// ─── Main function ─────────────────────────────────────────────────────────────

export async function createVisitForClient(
  clientId: string,
  executiveId: string,
  adminUserId: string
): Promise<{ visitId: string; visitNumber: string }> {
  // ── Guard: don't create duplicate pending/open visits ────────────────────
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

  // ── Load subtask templates (client-specific + global) ────────────────────
  const [clientTemplates, globalTemplates] = await Promise.all([
    prisma.subtaskTemplate.findMany({
      where: { clientId, isActive: true },
      orderBy: [{ taskType: "asc" }, { orderIndex: "asc" }],
    }),
    prisma.subtaskTemplate.findMany({
      where: { clientId: null, isActive: true },
      orderBy: [{ taskType: "asc" }, { orderIndex: "asc" }],
    }),
  ]);

  const clientTaskTypeSet = new Set(clientTemplates.map((t) => t.taskType));

  // Custom task types = client-specific types that are NOT in the 6 defaults
  const customTaskTypes = [...clientTaskTypeSet].filter((tt) => !DEFAULT_TASK_TYPE_SET.has(tt));

  // Build final ordered task type list
  const orderedTaskTypes: Array<{ type: string; title: string; orderIndex: number }> = [
    ...DEFAULT_TASK_TYPES.map((d) => ({ type: d.type, title: d.title, orderIndex: d.orderIndex })),
    ...customTaskTypes.map((type, i) => ({
      type,
      title: taskTypeToTitle(type),
      orderIndex: DEFAULT_TASK_TYPES.length + i,
    })),
  ];

  // ── STEP 1: Create the Visit record ─────────────────────────────────────
  // Plain write — no transaction wrapper — fully compatible with all Prisma adapters.
  const visit = await prisma.visit.create({
    data: {
      visitNumber,
      clientId,
      executiveId,
      status:        "PENDING",
      scheduledDate: now,
    },
  });

  // ── STEP 2: Create Tasks and Subtasks sequentially ───────────────────────
  for (const taskDef of orderedTaskTypes) {
    // Resolve subtasks: prefer client-specific templates, fall back to global
    const subtasks = clientTaskTypeSet.has(taskDef.type)
      ? clientTemplates.filter((t) => t.taskType === taskDef.type)
      : globalTemplates.filter((t) => t.taskType === taskDef.type);

    const task = await prisma.task.create({
      data: {
        visitId:    visit.id,
        taskType:   taskDef.type,
        title:      taskDef.title,
        status:     "PENDING",
        orderIndex: taskDef.orderIndex,
      },
    });

    if (subtasks.length > 0) {
      await prisma.subtask.createMany({
        data: subtasks.map((st) => ({
          taskId:          task.id,
          title:           st.title,
          isCompleted:     false,
          isCarriedForward: false,
        })),
      });
    }
  }

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
