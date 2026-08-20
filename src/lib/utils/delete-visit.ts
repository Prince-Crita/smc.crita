/**
 * Delete ONE visit occurrence — and nothing else.
 *
 * Scope rule (the whole point of this module): every row removed here is
 * selected by `visitId`, never by `clientId` or `executiveId`. A client with
 * visits on 20 Aug / 27 Aug / 03 Sep loses exactly the occurrence the admin
 * picked; the client row, its other visits, its task configuration
 * (ClientTaskType) and its subtask templates (SubtaskTemplate) are not
 * touched, and neither is any other executive's work.
 *
 * What belongs to a visit, and how each part is removed:
 *
 *   Visit → Task → Subtask          cascade (schema onDelete: Cascade)
 *   Visit → VisitAssignment         cascade (schema onDelete: Cascade) — this
 *                                   is what makes a TEAM visit disappear for
 *                                   the lead AND every member at once
 *   Visit ← ActivityLog             NO cascade — deleted below (visitId only;
 *                                   logs with a null visitId, e.g. client and
 *                                   executive audit entries, are untouched)
 *   Visit ← VisitReassignment       NO cascade — deleted below
 *   Visit ← VisitDelegation         NO cascade — deleted below
 *   Subtask ← Subtask.sourceSubtaskId (carry-forward provenance)
 *                                   NO cascade — cleared below
 *
 * The carry-forward pointer is the one link that reaches OUT of the visit: a
 * carried copy living in another visit points back at the subtask it came
 * from. Deleting the source without clearing those pointers trips the foreign
 * key and aborts the whole delete. They are set to NULL instead, which drops
 * only the provenance pointer — the other visit keeps its subtask, its title,
 * its completion state and its progress exactly as they were.
 *
 * Everything runs inside ONE interactive transaction, so the delete is
 * atomic: either the visit and all of its dependent rows are gone, or nothing
 * changed at all. No orphan rows, no dangling foreign keys either way.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

/** Counts of everything removed, for the audit log and the API response. */
export interface DeletedVisitCounts {
  // Index signature so the counts can be stored straight into a Prisma Json
  // column (ActivityLog.metadata / AdminOperation.beforeJson).
  [key: string]: number;
  tasks: number;
  subtasks: number;
  assignments: number;
  activityLogs: number;
  reassignments: number;
  delegations: number;
  /** Carried copies in OTHER visits whose provenance pointer was cleared. */
  carryForwardLinksCleared: number;
}

export interface DeletedVisitInfo {
  id: string;
  visitNumber: string;
  status: string;
  scheduledDate: Date;
  clientId: string;
  clientName: string;
  executiveId: string;
  executiveName: string;
  /** Every executive who could see this visit: the owner/lead + team members. */
  affectedExecutiveIds: string[];
  removed: DeletedVisitCounts;
}

export class VisitNotFoundError extends Error {
  constructor(visitId: string) {
    super(`Visit ${visitId} not found`);
    this.name = "VisitNotFoundError";
  }
}

type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

/**
 * Remove one visit and its visit-specific dependents inside `tx`.
 * Exported separately so a caller that is already in a transaction (or wants
 * to delete a visit as part of a larger atomic operation) can reuse it.
 *
 * @throws VisitNotFoundError when the id does not exist.
 */
export async function deleteVisitWithin(tx: Tx, visitId: string): Promise<DeletedVisitInfo> {
  const visit = await tx.visit.findUnique({
    where: { id: visitId },
    select: {
      id: true,
      visitNumber: true,
      status: true,
      scheduledDate: true,
      executiveId: true,
      client: { select: { id: true, name: true } },
      executive: { select: { id: true, name: true } },
      assignments: { select: { executiveId: true } },
    },
  });
  if (!visit) throw new VisitNotFoundError(visitId);

  // ── Everything below is keyed on THIS visit's id ─────────────────────────
  const tasks = await tx.task.findMany({ where: { visitId }, select: { id: true } });
  const taskIds = tasks.map((t) => t.id);

  const subtasks = taskIds.length
    ? await tx.subtask.findMany({ where: { taskId: { in: taskIds } }, select: { id: true } })
    : [];
  const subtaskIds = subtasks.map((s) => s.id);

  // Clear inbound carry-forward provenance pointers before the cascade runs.
  let carryForwardLinksCleared = 0;
  if (subtaskIds.length > 0) {
    carryForwardLinksCleared = (
      await tx.subtask.updateMany({
        where: { sourceSubtaskId: { in: subtaskIds } },
        data: { sourceSubtaskId: null },
      })
    ).count;
  }

  const activityLogs = (await tx.activityLog.deleteMany({ where: { visitId } })).count;
  const reassignments = (await tx.visitReassignment.deleteMany({ where: { visitId } })).count;
  const delegations = (await tx.visitDelegation.deleteMany({ where: { visitId } })).count;
  const assignments = visit.assignments.length;

  // Tasks, subtasks and team assignments cascade from this one delete.
  await tx.visit.delete({ where: { id: visitId } });

  const affectedExecutiveIds = [
    ...new Set([visit.executiveId, ...visit.assignments.map((a) => a.executiveId)]),
  ];

  return {
    id: visit.id,
    visitNumber: visit.visitNumber,
    status: visit.status,
    scheduledDate: visit.scheduledDate,
    clientId: visit.client.id,
    clientName: visit.client.name,
    executiveId: visit.executive.id,
    executiveName: visit.executive.name,
    affectedExecutiveIds,
    removed: {
      tasks: taskIds.length,
      subtasks: subtaskIds.length,
      assignments,
      activityLogs,
      reassignments,
      delegations,
      carryForwardLinksCleared,
    },
  };
}

/**
 * Atomically delete one visit occurrence. Opens its own transaction.
 *
 * @throws VisitNotFoundError when the id does not exist (nothing is written).
 */
export async function deleteVisitDeep(visitId: string): Promise<DeletedVisitInfo> {
  return prisma.$transaction((tx: Prisma.TransactionClient) => deleteVisitWithin(tx as unknown as Tx, visitId));
}
