/**
 * Per-visit subtask totals, counted in the database.
 *
 * Every admin/executive list screen needs the same three numbers per visit —
 * how many subtasks it has, how many are done, how many were carried forward
 * — and they were all obtained the same way: by loading EVERY subtask row of
 * EVERY visit and counting them in JavaScript
 * (`tasks: { select: { subtasks: { select: { isCompleted, isCarriedForward } } } }`).
 *
 * That is one row per subtask. On a database with 2,000 visits × 6 tasks × 5
 * subtasks it means 60,000 rows crossing the wire, being materialised into
 * 60,000 JS objects and re-counted, on every dashboard load — for three
 * integers per visit. It is also why those visit arrays were serialised back
 * to the browser with their whole `tasks` tree attached.
 *
 * This module asks Postgres for the counts instead: one row per VISIT.
 * The arithmetic and every downstream meaning (progress %, displayStatus) are
 * unchanged — `toVisitTotals` feeds the same `calculateProgress` /
 * `calculateDisplayStatus` helpers the old path used, so no screen can start
 * disagreeing with another.
 *
 * Freshness is unchanged too: this is a plain query on every request, with no
 * caching layer of any kind, so an executive ticking a subtask still shows up
 * on the admin's next load exactly as before.
 */

import { prisma } from "@/lib/db/prisma";
import {
  calculateDisplayStatus,
  calculateProgress,
  type DisplayStatus,
} from "@/lib/utils/visit-status";

export interface VisitSubtaskCounts {
  total: number;
  completed: number;
  carried: number;
}

/** Zero counts — the value used for a visit that has no tasks/subtasks yet. */
const EMPTY: VisitSubtaskCounts = { total: 0, completed: 0, carried: 0 };

interface CountRow {
  visitId: string;
  total: number;
  completed: number;
  carried: number;
}

/**
 * Subtask counts keyed by visit id.
 *
 * @param visitIds Restrict to these visits. Omit for every visit (used by the
 *                 admin dashboard/list, which genuinely shows all of them).
 *                 An EMPTY array means "no visits" and returns an empty map
 *                 without touching the database.
 *
 * Visits with no tasks simply do not appear in the map; read them through
 * `countsFor`, which falls back to zeros.
 */
export async function getVisitSubtaskCounts(
  visitIds?: string[]
): Promise<Map<string, VisitSubtaskCounts>> {
  if (visitIds && visitIds.length === 0) return new Map();

  // LEFT JOIN so a task with no subtasks still contributes its visit with a
  // zero count, matching the old in-memory reduce over an empty array.
  const rows = visitIds
    ? await prisma.$queryRaw<CountRow[]>`
        SELECT t."visitId" AS "visitId",
               COUNT(s.id)::int AS total,
               COUNT(s.id) FILTER (WHERE s."isCompleted")::int AS completed,
               COUNT(s.id) FILTER (WHERE s."isCarriedForward")::int AS carried
        FROM tasks t
        LEFT JOIN subtasks s ON s."taskId" = t.id
        WHERE t."visitId" = ANY(${visitIds})
        GROUP BY t."visitId"`
    : await prisma.$queryRaw<CountRow[]>`
        SELECT t."visitId" AS "visitId",
               COUNT(s.id)::int AS total,
               COUNT(s.id) FILTER (WHERE s."isCompleted")::int AS completed,
               COUNT(s.id) FILTER (WHERE s."isCarriedForward")::int AS carried
        FROM tasks t
        LEFT JOIN subtasks s ON s."taskId" = t.id
        GROUP BY t."visitId"`;

  const map = new Map<string, VisitSubtaskCounts>();
  for (const r of rows) {
    map.set(r.visitId, { total: r.total, completed: r.completed, carried: r.carried });
  }
  return map;
}

/** Counts for one visit, zeros when it has no subtasks. */
export function countsFor(
  map: Map<string, VisitSubtaskCounts>,
  visitId: string
): VisitSubtaskCounts {
  return map.get(visitId) ?? EMPTY;
}

/**
 * Same return shape as `getSubtaskTotals`, computed from counts instead of
 * from loaded subtask rows. Drop-in replacement at every call site.
 */
export function totalsFromCounts(
  counts: VisitSubtaskCounts,
  dbStatus?: string
): {
  totalSubtasks: number;
  completedSubtasks: number;
  carryForwardCount: number;
  progress: number;
  displayStatus: DisplayStatus;
} {
  return {
    totalSubtasks: counts.total,
    completedSubtasks: counts.completed,
    carryForwardCount: counts.carried,
    progress: calculateProgress(counts.completed, counts.total),
    displayStatus: calculateDisplayStatus(counts.completed, counts.total, dbStatus),
  };
}

/** Convenience: counts map → totals for one visit id. */
export function totalsForVisit(
  map: Map<string, VisitSubtaskCounts>,
  visitId: string,
  dbStatus?: string
) {
  return totalsFromCounts(countsFor(map, visitId), dbStatus);
}
