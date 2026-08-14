/**
 * Recording and reversing administrative operations (§1).
 *
 * Every recorded operation stores the affected entity's field values BEFORE
 * and AFTER the change, so an undo restores real prior state rather than
 * guessing. Operations that cannot be safely reversed (cascade deletes, for
 * example) are still recorded for the activity view but are marked
 * `isReversible: false`, and `undoOperation` refuses them instead of
 * fabricating rows and corrupting relations.
 */
import { prisma } from "@/lib/db/prisma";
import { applyAssignment } from "@/lib/utils/visit-assignment";

/** Entities whose scalar updates can be restored field-by-field. */
export type ReversibleEntity =
  | "Client" | "Visit" | "Subtask" | "Task" | "User" | "Attendance" | "LeaveRequest";

export interface RecordOperationInput {
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  isReversible?: boolean;
  /** Why the actor made this change, when they supplied a reason. */
  reason?: string | null;
}

/** Field-level update operations that undo knows how to reverse. */
const REVERSIBLE_ENTITIES = new Set<string>([
  "Client", "Visit", "Subtask", "Task", "User", "Attendance", "LeaveRequest",
]);

/**
 * Record an administrative operation. Never throws into the caller's path —
 * an audit failure must not roll back the real work that just succeeded.
 */
export async function recordOperation(input: RecordOperationInput): Promise<string | null> {
  try {
    const reversible =
      input.isReversible ??
      (REVERSIBLE_ENTITIES.has(input.entityType) && !!input.before && !!input.after);

    const op = await prisma.adminOperation.create({
      data: {
        userId: input.userId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        summary: input.summary,
        reason: input.reason?.trim() || null,
        beforeJson: (input.before ?? undefined) as never,
        afterJson: (input.after ?? undefined) as never,
        isReversible: reversible,
      },
      select: { id: true },
    });
    return op.id;
  } catch (err) {
    console.error("[admin-operations] failed to record operation:", err);
    return null;
  }
}

/** Which scalar columns undo is allowed to write back, per entity. */
const RESTORABLE_FIELDS: Record<string, string[]> = {
  Client: [
    "name", "contactPerson", "address", "phone", "email", "reportEmails",
    "assignedExecId", "startDate", "endDate", "isArchived",
  ],
  Visit: ["executiveId", "visitType", "scheduledDate", "endDate", "status", "notes"],
  Subtask: ["title", "isCompleted", "incompletionReason", "carryForwardRejectedAt"],
  Task: ["title", "status", "orderIndex", "mdMeetingAnswer"],
  User: ["name", "email", "phone", "isActive"],
  // `date` is excluded on purpose: it is half of the (executiveId, date)
  // unique key, so restoring it could collide with another day's record.
  Attendance: ["punchIn", "punchOut", "workingMinutes", "isLate", "notes"],
  LeaveRequest: ["status", "adminComment", "reason"],
};

const DATE_FIELDS = new Set([
  "startDate", "endDate", "scheduledDate", "carryForwardRejectedAt", "completedAt",
  "punchIn", "punchOut",
]);

/** Read the entity's current values for the fields an undo/redo will touch. */
async function readCurrent(
  entityType: string,
  entityId: string,
  fields: string[]
): Promise<Record<string, unknown> | null> {
  const select = Object.fromEntries(fields.map((f) => [f, true]));
  let row: Record<string, unknown> | null = null;
  switch (entityType) {
    case "Client":  row = await prisma.client.findUnique({ where: { id: entityId }, select }) as never; break;
    case "Visit":   row = await prisma.visit.findUnique({ where: { id: entityId }, select }) as never; break;
    case "Subtask": row = await prisma.subtask.findUnique({ where: { id: entityId }, select }) as never; break;
    case "Task":    row = await prisma.task.findUnique({ where: { id: entityId }, select }) as never; break;
    case "User":    row = await prisma.user.findUnique({ where: { id: entityId }, select }) as never; break;
    case "Attendance":   row = await prisma.attendance.findUnique({ where: { id: entityId }, select }) as never; break;
    case "LeaveRequest": row = await prisma.leaveRequest.findUnique({ where: { id: entityId }, select }) as never; break;
    default: return null;
  }
  return row;
}

/** The visit's current MEMBER executive ids (lead excluded). */
async function currentMemberIds(visitId: string): Promise<string[]> {
  const rows = await prisma.visitAssignment.findMany({
    where: { visitId, role: { not: "LEAD" } },
    select: { executiveId: true },
  });
  return rows.map((r) => r.executiveId);
}

/** Build the whitelisted write payload from a recorded snapshot. */
function payloadFrom(snapshot: unknown, fields: string[]): Record<string, unknown> {
  const snap = (snapshot ?? {}) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  for (const key of fields) {
    if (!(key in snap)) continue;
    const value = snap[key];
    data[key] = DATE_FIELDS.has(key) && typeof value === "string" ? new Date(value) : value;
  }
  return data;
}

/**
 * Team membership cannot be restored by writing scalar columns: the members
 * live in VisitAssignment rows. An operation that changed a visit's
 * assignment therefore records `memberIds` alongside the scalars, and undo /
 * redo replay it through the SAME applyAssignment path the admin workflow
 * uses. Without this, undoing a team change would restore the lead but leave
 * the previous members' rows in place — an undo the UI claimed had worked
 * while the data said otherwise.
 */
function memberIdsFrom(snapshot: unknown): string[] | null {
  const snap = (snapshot ?? {}) as Record<string, unknown>;
  const raw = snap.memberIds;
  if (!Array.isArray(raw)) return null;
  return raw.filter((v): v is string => typeof v === "string");
}

async function applyToEntity(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  entityType: string,
  entityId: string,
  data: Record<string, unknown>,
  memberIds?: string[] | null
): Promise<void> {
  // Visit assignment restore — rewrites lead + member rows without touching
  // the visit's tasks, subtasks or history, so nothing is duplicated or lost.
  if (entityType === "Visit" && memberIds && typeof data.executiveId === "string") {
    const visitType = data.visitType === "TEAM" ? "TEAM" : "SOLO";
    await applyAssignment(tx, entityId, {
      visitType,
      leadId: data.executiveId,
      memberIds: visitType === "TEAM" ? memberIds : [],
    });
    const rest = { ...data };
    delete rest.executiveId;
    delete rest.visitType;
    if (Object.keys(rest).length > 0) {
      await tx.visit.update({ where: { id: entityId }, data: rest });
    }
    return;
  }

  switch (entityType) {
    case "Client":  await tx.client.update({ where: { id: entityId }, data }); break;
    case "Visit":   await tx.visit.update({ where: { id: entityId }, data }); break;
    case "Subtask": await tx.subtask.update({ where: { id: entityId }, data }); break;
    case "Task":    await tx.task.update({ where: { id: entityId }, data }); break;
    case "User":    await tx.user.update({ where: { id: entityId }, data }); break;
    case "Attendance":   await tx.attendance.update({ where: { id: entityId }, data }); break;
    case "LeaveRequest": await tx.leaveRequest.update({ where: { id: entityId }, data }); break;
    default: throw new Error(`Unsupported entity ${entityType}`);
  }
}

/**
 * Reverse a recorded operation by writing its `before` values back.
 *
 * Only whitelisted scalar fields are restored, so an undo can never rewrite
 * ids or relations into an inconsistent shape: task/subtask rows, completion
 * history, assignments, attendance and carry-forward links are never deleted
 * or recreated — an undo is a field-level restore, nothing more.
 *
 * The undo is itself recorded as its own audit entry, and the original keeps
 * its `undoneAt`/`undoneById` stamps, so the history stays readable after the
 * fact and the same operation can never be undone twice.
 */
export async function undoOperation(
  operationId: string,
  undoneByUserId: string,
  reason?: string | null
): Promise<{ ok: boolean; error?: string; restored?: string[] }> {
  const op = await prisma.adminOperation.findUnique({ where: { id: operationId } });
  if (!op) return { ok: false, error: "Operation not found" };
  if (op.undoneAt) return { ok: false, error: "This operation has already been undone" };
  if (!op.isReversible) {
    return { ok: false, error: "This operation is not reversible and cannot be undone safely." };
  }

  const fields = RESTORABLE_FIELDS[op.entityType];
  if (!fields) return { ok: false, error: `Undo is not supported for ${op.entityType}` };

  const data = payloadFrom(op.beforeJson, fields);
  if (Object.keys(data).length === 0) {
    return { ok: false, error: "Nothing recorded to restore for this operation" };
  }

  const memberIds = memberIdsFrom(op.beforeJson);

  // Snapshot what we are about to overwrite, so the undo's own audit entry
  // shows a truthful before/after rather than an assumption.
  const current = await readCurrent(op.entityType, op.entityId, Object.keys(data));
  if (!current) {
    return { ok: false, error: `The ${op.entityType} this operation changed no longer exists.` };
  }
  if (memberIds) current.memberIds = await currentMemberIds(op.entityId);

  try {
    await prisma.$transaction(async (tx) => {
      await applyToEntity(tx, op.entityType, op.entityId, data, memberIds);
      await tx.adminOperation.update({
        where: { id: op.id },
        data: { undoneAt: new Date(), undoneById: undoneByUserId },
      });
    });
  } catch (err) {
    console.error("[admin-operations] undo failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : "Undo failed" };
  }

  // Recorded AFTER the transaction: an audit write must never roll back the
  // restore that already succeeded.
  await recordOperation({
    userId: undoneByUserId,
    action: "SUPER_ADMIN_UNDO",
    entityType: op.entityType,
    entityId: op.entityId,
    summary: `Undid: ${op.summary}`,
    reason,
    before: current,
    after: memberIds ? { ...data, memberIds } : data,
    // Reversing an undo is "redo", which goes through redoOperation and its
    // own eligibility rules — not through undoing this bookkeeping entry.
    isReversible: false,
  });

  return { ok: true, restored: Object.keys(data) };
}

/**
 * Re-apply an operation that was undone (§5).
 *
 * Only an operation that is currently undone can be redone, and only through
 * the same whitelist an undo uses — so a redo is exactly as safe as the undo
 * that preceded it. The redo is recorded as its own reversible entry (undoing
 * it is what "undo the redo" means), and the original keeps its undo stamps
 * so the audit trail still shows what actually happened, in order.
 */
export async function redoOperation(
  operationId: string,
  redoneByUserId: string,
  reason?: string | null
): Promise<{ ok: boolean; error?: string; reapplied?: string[] }> {
  const op = await prisma.adminOperation.findUnique({ where: { id: operationId } });
  if (!op) return { ok: false, error: "Operation not found" };
  if (!op.undoneAt) {
    return { ok: false, error: "Only an operation that was undone can be redone." };
  }
  if (!op.isReversible) {
    return { ok: false, error: "This operation is not reversible and cannot be redone safely." };
  }

  const fields = RESTORABLE_FIELDS[op.entityType];
  if (!fields) return { ok: false, error: `Redo is not supported for ${op.entityType}` };

  const data = payloadFrom(op.afterJson, fields);
  if (Object.keys(data).length === 0) {
    return { ok: false, error: "Nothing recorded to re-apply for this operation" };
  }

  // A redo that is still standing must not be applied a second time.
  const existingRedo = await prisma.adminOperation.findFirst({
    where: {
      action: "SUPER_ADMIN_REDO",
      undoneAt: null,
      afterJson: { path: ["__redoOf"], equals: op.id },
    },
    select: { id: true },
  });
  if (existingRedo) {
    return { ok: false, error: "This operation has already been redone." };
  }

  const memberIds = memberIdsFrom(op.afterJson);

  const current = await readCurrent(op.entityType, op.entityId, Object.keys(data));
  if (!current) {
    return { ok: false, error: `The ${op.entityType} this operation changed no longer exists.` };
  }
  if (memberIds) current.memberIds = await currentMemberIds(op.entityId);

  try {
    await prisma.$transaction(async (tx) => {
      await applyToEntity(tx, op.entityType, op.entityId, data, memberIds);
    });
  } catch (err) {
    console.error("[admin-operations] redo failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : "Redo failed" };
  }

  await recordOperation({
    userId: redoneByUserId,
    action: "SUPER_ADMIN_REDO",
    entityType: op.entityType,
    entityId: op.entityId,
    summary: `Redid: ${op.summary}`,
    reason,
    before: current,
    // `__redoOf` links this entry back to the operation it re-applied; undo
    // ignores keys outside the whitelist, so carrying it here is inert.
    after: { ...data, ...(memberIds ? { memberIds } : {}), __redoOf: op.id },
    isReversible: true,
  });

  return { ok: true, reapplied: Object.keys(data) };
}

/** True when this (undone) operation may still be re-applied. */
export async function canRedo(operationId: string): Promise<boolean> {
  const op = await prisma.adminOperation.findUnique({
    where: { id: operationId },
    select: { undoneAt: true, isReversible: true, entityType: true },
  });
  if (!op || !op.undoneAt || !op.isReversible) return false;
  if (!RESTORABLE_FIELDS[op.entityType]) return false;
  const redone = await prisma.adminOperation.findFirst({
    where: { action: "SUPER_ADMIN_REDO", undoneAt: null, afterJson: { path: ["__redoOf"], equals: operationId } },
    select: { id: true },
  });
  return !redone;
}

/** Undo every reversible operation in the last `minutes`, newest first. */
export async function undoWindow(
  minutes: number,
  undoneByUserId: string,
  reason?: string | null
): Promise<{ undone: number; skipped: number; errors: string[] }> {
  const since = new Date(Date.now() - minutes * 60_000);
  const ops = await prisma.adminOperation.findMany({
    where: { createdAt: { gte: since }, undoneAt: null, isReversible: true },
    orderBy: { createdAt: "desc" },
  });

  let undone = 0;
  let skipped = 0;
  const errors: string[] = [];
  // Newest first, so a field changed twice ends on its oldest recorded value.
  for (const op of ops) {
    const res = await undoOperation(op.id, undoneByUserId, reason);
    if (res.ok) undone++;
    else { skipped++; if (res.error) errors.push(`${op.summary}: ${res.error}`); }
  }
  return { undone, skipped, errors };
}
