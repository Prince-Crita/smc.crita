/**
 * Who may see and who may close a visit.
 *
 * A visit is worked either SOLO (one executive) or by a TEAM (a lead plus
 * members). `Visit.executiveId` is the single owner pointer in both cases —
 * the solo executive, or the team LEAD — and team members are additional rows
 * in `VisitAssignment`. Keeping that invariant is what lets every existing
 * admin query, reassignment path and lead-only rule keep working unchanged.
 *
 * Use these helpers instead of comparing `visit.executiveId` by hand, so the
 * team rules stay in one place.
 */
import type { Prisma } from "@prisma/client";

/** Shape shared by the visit rows these helpers are called with. */
export interface VisitAccessShape {
  executiveId: string;
  assignments?: { executiveId: string; role: string }[];
}

/**
 * `where` fragment selecting the visits an executive may see: the ones they
 * own (solo executive or team lead) plus the team visits they are a member of.
 */
export function executiveVisitScope(userId: string): Prisma.VisitWhereInput {
  return {
    OR: [
      { executiveId: userId },
      { assignments: { some: { executiveId: userId } } },
    ],
  };
}

/** True when the executive owns the visit or is on its team. */
export function canViewVisit(visit: VisitAccessShape, userId: string): boolean {
  if (visit.executiveId === userId) return true;
  return (visit.assignments ?? []).some((a) => a.executiveId === userId);
}

/**
 * True when the executive may work the visit's tasks/subtasks — the same set
 * that may view it. Members are expected to complete their share of the work.
 */
export function canWorkVisit(visit: VisitAccessShape, userId: string): boolean {
  return canViewVisit(visit, userId);
}

/**
 * True only for the visit owner: the solo executive, or the TEAM LEAD.
 * Closing, delegating and rescheduling stay lead-only — a team member must
 * not be able to close a visit out from under the lead.
 */
export function canCloseVisit(visit: VisitAccessShape, userId: string): boolean {
  return visit.executiveId === userId;
}

/** True when the executive is on the team but is NOT the lead. */
export function isTeamMemberOnly(visit: VisitAccessShape, userId: string): boolean {
  return canViewVisit(visit, userId) && !canCloseVisit(visit, userId);
}
