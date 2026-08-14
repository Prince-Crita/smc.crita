/**
 * Applying a SOLO / TEAM assignment to a visit.
 *
 * Invariant this module maintains, relied on everywhere else:
 *   • Visit.executiveId is ALWAYS the owner — the solo executive, or the team
 *     LEAD. Existing admin filters, reassignment history and the lead-only
 *     close rule keep working because of it.
 *   • SOLO visits carry no VisitAssignment rows.
 *   • TEAM visits carry one LEAD row (mirroring executiveId) plus one MEMBER
 *     row per additional executive.
 *
 * Switching a visit between SOLO and TEAM only rewrites those rows — the visit
 * itself, its tasks, subtasks and history are never recreated, so no duplicate
 * visit is produced and no progress is lost.
 */
import type { Prisma, PrismaClient } from "@prisma/client";

export type VisitTypeInput = "SOLO" | "TEAM";

export interface AssignmentInput {
  visitType?: VisitTypeInput;
  /** Solo executive, or the team lead when visitType is TEAM. */
  executiveId?: string;
  /** Additional executives for a TEAM visit (lead excluded). */
  memberIds?: string[];
}

export interface NormalizedAssignment {
  visitType: VisitTypeInput;
  leadId: string;
  memberIds: string[];
}

/** A transaction client or the base client — both expose the models used here. */
type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Result of validating an assignment payload: exactly one of the two fields
 * is set. Written as a plain optional-field object rather than a discriminated
 * union because this project compiles with `strict: false`, where TypeScript
 * will not narrow a union on a boolean discriminant.
 */
export interface AssignmentResult {
  /** Set when validation failed — the message is safe to show the admin. */
  error?: string;
  /** Set when validation succeeded. */
  value?: NormalizedAssignment;
}

/**
 * Validate an assignment payload.
 * Returns either the normalized assignment or a human-readable error.
 */
export function normalizeAssignment(
  input: AssignmentInput,
  fallbackLeadId?: string
): AssignmentResult {
  const visitType: VisitTypeInput = input.visitType === "TEAM" ? "TEAM" : "SOLO";
  const leadId = input.executiveId || fallbackLeadId;

  if (!leadId) {
    return { error: visitType === "TEAM" ? "A Team Lead is required." : "An executive is required." };
  }

  if (visitType === "SOLO") {
    return { value: { visitType, leadId, memberIds: [] } };
  }

  // De-duplicate, and never let the lead appear again as a member — that is
  // the "prevent the same executive from being selected twice" rule, enforced
  // server-side as well as in the picker.
  const members = [...new Set(input.memberIds ?? [])].filter((id) => id && id !== leadId);
  if (members.length === 0) {
    return { error: "A Team Visit needs at least one team member besides the Team Lead." };
  }

  return { value: { visitType, leadId, memberIds: members } };
}

/**
 * Write the assignment onto an existing visit, replacing whatever was there.
 * Caller is responsible for the surrounding transaction and for any
 * reassignment/activity logging.
 */
export async function applyAssignment(
  db: Db,
  visitId: string,
  assignment: NormalizedAssignment
): Promise<void> {
  await db.visit.update({
    where: { id: visitId },
    data: { visitType: assignment.visitType, executiveId: assignment.leadId },
  });

  // Rewrite team rows from scratch — simplest correct way to handle
  // SOLO→TEAM, TEAM→SOLO, lead changes and member add/remove in one path.
  await db.visitAssignment.deleteMany({ where: { visitId } });

  if (assignment.visitType === "TEAM") {
    await db.visitAssignment.createMany({
      data: [
        { visitId, executiveId: assignment.leadId, role: "LEAD" as const },
        ...assignment.memberIds.map((id) => ({ visitId, executiveId: id, role: "MEMBER" as const })),
      ],
    });
  }
}

/** Read a visit's current assignment in the same shape the API accepts. */
export async function readAssignment(
  db: Db,
  visitId: string
): Promise<NormalizedAssignment | null> {
  const visit = await db.visit.findUnique({
    where: { id: visitId },
    select: {
      executiveId: true,
      visitType: true,
      assignments: { select: { executiveId: true, role: true } },
    },
  });
  if (!visit) return null;
  return {
    visitType: visit.visitType === "TEAM" ? "TEAM" : "SOLO",
    leadId: visit.executiveId,
    memberIds: visit.assignments.filter((a) => a.role !== "LEAD").map((a) => a.executiveId),
  };
}
