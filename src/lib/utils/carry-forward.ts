import { prisma } from "@/lib/db/prisma";
import { Task, Subtask, Visit } from "@prisma/client";
import { createVisitForClient } from "@/lib/utils/create-visit";
import { toMidnightIST } from "@/lib/utils/attendance";

interface TaskWithSubtasks extends Task {
  subtasks: Subtask[];
}

interface VisitWithTasks extends Visit {
  tasks: TaskWithSubtasks[];
}

// ─── Carry-forward marker (shared) ─────────────────────────────────────────
// Any Visit whose `notes` contains this prefix was auto-created (or manually
// annotated) as a carry-forward visit — e.g. the "Missed Weekly Visit" flow
// below. Subtask-level carry-forward (isCarriedForward on Subtask) is a
// SEPARATE origin (Business Rule 1). A visit can be flagged as carry-forward
// for either reason, or both — see isCarryForwardVisit().
export const CARRY_FORWARD_NOTE_PREFIX = "[CARRY-FORWARD:";

// Written by the reschedule flow when the admin chooses "Carry Forward: No".
// Records the date the visit was moved AWAY from, so the missed-weekly check
// still counts that week as "planned/handled" for the client instead of
// auto-generating an incorrect carry-forward visit for it.
export const RESCHEDULED_FROM_NOTE_PREFIX = "[RESCHEDULED-FROM:";

/**
 * True if a visit is carry-forward by NOTES marker (visit-level origin,
 * e.g. an auto-created "Missed Weekly Visit"). This is independent of, and
 * additive with, subtask-level carry-forward (Subtask.isCarriedForward).
 * Callers should treat a visit as "has carry-forward" when EITHER is true:
 *   subtaskLevelCarryForwardCount > 0 || isCarryForwardVisit(visit)
 */
export function isCarryForwardVisit(visit: { notes: string | null }): boolean {
  return !!visit.notes && visit.notes.includes(CARRY_FORWARD_NOTE_PREFIX);
}

// ─── Visit end-date semantics ───────────────────────────────────────────────
// Every visit has a working window [scheduledDate .. endDate]. Carry-forward
// is generated ONLY after the end date has passed (Business Rule: Case 1 -
// end date not passed → no carry-forward; Case 2 - end date passed AND
// incomplete tasks → auto carry-forward). When no explicit endDate is set,
// the window ends at the end of the scheduledDate's IST calendar day.
export function getEffectiveEndDate(visit: { scheduledDate: Date; endDate?: Date | null }): Date {
  if (visit.endDate) return visit.endDate;
  const dayStart = toMidnightIST(visit.scheduledDate);
  return new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
}

export function hasEndDatePassed(visit: { scheduledDate: Date; endDate?: Date | null }, now = new Date()): boolean {
  return now.getTime() > getEffectiveEndDate(visit).getTime();
}

/**
 * Calculate progress percentage for a visit based on completed subtasks
 */
export function calculateProgress(tasks: TaskWithSubtasks[]): {
  percentage: number;
  completedSubtasks: number;
  totalSubtasks: number;
  completedTasks: number;
  totalTasks: number;
} {
  let completedSubtasks = 0;
  let totalSubtasks = 0;
  let completedTasks = 0;

  for (const task of tasks) {
    const taskTotal = task.subtasks.length;
    const taskCompleted = task.subtasks.filter((s) => s.isCompleted).length;

    totalSubtasks += taskTotal;
    completedSubtasks += taskCompleted;

    if (taskCompleted === taskTotal && taskTotal > 0) {
      completedTasks++;
    }
  }

  const percentage = totalSubtasks === 0 ? 0 : Math.round((completedSubtasks / totalSubtasks) * 100);

  return {
    percentage,
    completedSubtasks,
    totalSubtasks,
    completedTasks,
    totalTasks: tasks.length,
  };
}

/**
 * Validate that a visit can be closed
 * Returns array of blocking errors
 */
export function validateVisitClose(visit: VisitWithTasks): string[] {
  const errors: string[] = [];

  for (const task of visit.tasks) {
    // Check MD Meeting confirmation
    if (task.taskType === "MD_MEETING" && !task.mdMeetingAnswer) {
      errors.push("MD Meeting confirmation (YES/NO) is mandatory before closing the visit.");
    }

    // Check MR Monthly Report "Completed" answer (stored in the same
    // mdMeetingAnswer column - it's a per-task YES/NO answer field, and the
    // task type disambiguates its meaning)
    if (task.taskType === "MR_MONTHLY_REPORT" && !task.mdMeetingAnswer) {
      errors.push("MR Monthly Report requires the \"Completed\" field (Yes/No) to be answered before closing the visit.");
    }

    // Check incomplete subtasks have reasons
    for (const subtask of task.subtasks) {
      if (!subtask.isCompleted && !subtask.incompletionReason?.trim()) {
        errors.push(
          `Task "${task.title}" has incomplete subtask "${subtask.title}" without a reason. Please provide a reason for all incomplete items.`
        );
      }
    }
  }

  return errors;
}

/**
 * Execute carry-forward logic when a visit is closed
 * Finds next visit for the same client and carries incomplete subtasks forward
 */
export async function executeCarryForward(
  closedVisit: VisitWithTasks,
  closedByUserId: string
): Promise<{ carriedCount: number; nextVisitId: string | null }> {
  // Find all incomplete subtasks
  const candidates: { subtask: Subtask; task: Task }[] = [];
  for (const task of closedVisit.tasks) {
    for (const subtask of task.subtasks) {
      if (!subtask.isCompleted) {
        candidates.push({ subtask, task });
      }
    }
  }

  // Idempotency: never carry a subtask twice. A subtask is "already carried"
  // when another subtask points at it via sourceSubtaskId. This makes the
  // function safe to call from both the close flow and the background sweep
  // (processDueCarryForwards) without creating duplicate carry-forward rows.
  const alreadyCarried = candidates.length > 0
    ? await prisma.subtask.findMany({
        where: { sourceSubtaskId: { in: candidates.map((c) => c.subtask.id) } },
        select: { sourceSubtaskId: true },
      })
    : [];
  const carriedSet = new Set(alreadyCarried.map((s) => s.sourceSubtaskId));
  const incompleteSubtasks = candidates.filter((c) => !carriedSet.has(c.subtask.id));

  if (incompleteSubtasks.length === 0) {
    return { carriedCount: 0, nextVisitId: null };
  }

  // Find the next pending/upcoming visit for the same client
  let nextVisit = await prisma.visit.findFirst({
    where: {
      clientId: closedVisit.clientId,
      status: { in: ["PENDING", "OPEN"] },
      scheduledDate: { gt: closedVisit.scheduledDate },
    },
    orderBy: { scheduledDate: "asc" },
    include: {
      tasks: {
        include: { subtasks: true },
      },
    },
  });

  // No upcoming visit yet? Auto-create one so incomplete subtasks are NEVER
  // silently dropped. Previously this returned early without persisting
  // anything, so the Carry-Forward page showed nothing even though the
  // closed visit had incomplete items. The new visit is scheduled exactly
  // one week after the closed visit (same weekday/time - the app's weekly
  // cadence), for the same executive.
  //
  // skipActiveDuplicateGuard is REQUIRED here: at this point the visit being
  // closed is still status=OPEN in the DB, so the duplicate guard would
  // return the closing visit itself and we'd carry subtasks into the very
  // visit that is being closed.
  if (!nextVisit) {
    const nextDate = new Date(closedVisit.scheduledDate);
    nextDate.setUTCDate(nextDate.getUTCDate() + 7);
    const { visitId } = await createVisitForClient(
      closedVisit.clientId,
      closedVisit.executiveId,
      closedByUserId,
      {
        scheduledDate: nextDate,
        notes: `${CARRY_FORWARD_NOTE_PREFIX} Incomplete items from ${closedVisit.visitNumber}]`,
        skipActiveDuplicateGuard: true,
      }
    );
    nextVisit = await prisma.visit.findUnique({
      where: { id: visitId },
      include: { tasks: { include: { subtasks: true } } },
    });
  }

  if (!nextVisit) {
    // Safety net - should be unreachable (visit was just created above).
    return { carriedCount: 0, nextVisitId: null };
  }

  // Group incomplete subtasks by task type
  const byTaskType = new Map<string, { subtask: Subtask; task: Task }[]>();
  for (const item of incompleteSubtasks) {
    const key = item.task.taskType;
    if (!byTaskType.has(key)) byTaskType.set(key, []);
    byTaskType.get(key)!.push(item);
  }

  // For each task type with incomplete subtasks, find matching task in next visit and add subtasks
  let carriedCount = 0;
  const nextVisitWithTasks = nextVisit as typeof nextVisit & { tasks: TaskWithSubtasks[] };

  for (const [taskType, items] of byTaskType.entries()) {
    let matchingTask = nextVisitWithTasks.tasks.find((t) => t.taskType === taskType);

    // The next visit may not have this task type (e.g. a custom main task
    // that was later removed from the client's config). Create it rather
    // than silently dropping the carried subtasks.
    if (!matchingTask) {
      const sourceTask = items[0].task;
      const maxOrder = nextVisitWithTasks.tasks.reduce((m, t) => Math.max(m, t.orderIndex), -1);
      const created = await prisma.task.create({
        data: {
          visitId: nextVisitWithTasks.id,
          taskType,
          title: sourceTask.title,
          status: "PENDING",
          orderIndex: maxOrder + 1,
        },
      });
      matchingTask = { ...created, subtasks: [] };
      nextVisitWithTasks.tasks.push(matchingTask);
    }

    // Title-level dedupe: if the destination task already holds a pending
    // carried subtask with the same title (e.g. the same checklist item
    // missed on TWO earlier visits), don't stack a duplicate row - one
    // pending carry-forward per item is the business rule.
    const existingTitles = new Set(
      matchingTask.subtasks
        .filter((s) => s.isCarriedForward && !s.isCompleted)
        .map((s) => s.title.replace("[CARRY-FORWARD] ", ""))
    );

    for (const { subtask } of items) {
      const cleanTitle = subtask.title.replace("[CARRY-FORWARD] ", "");
      if (existingTitles.has(cleanTitle)) continue;
      existingTitles.add(cleanTitle);
      try {
        await prisma.subtask.create({
          data: {
            taskId: matchingTask.id,
            title: `[CARRY-FORWARD] ${cleanTitle}`,
            isCompleted: false,
            isCarriedForward: true,
            sourceSubtaskId: subtask.id,
          },
        });
        carriedCount++;
      } catch (err) {
        // P2002 = the @@unique([taskId, sourceSubtaskId]) guard fired - a
        // concurrent sweep already carried this exact subtask. Safe to skip.
        if ((err as { code?: string })?.code !== "P2002") throw err;
      }
    }
  }

  // Log carry-forward activity
  await prisma.activityLog.create({
    data: {
      visitId: nextVisit.id,
      userId: closedByUserId,
      action: "CARRY_FORWARD_APPLIED",
      metadata: {
        fromVisitId: closedVisit.id,
        fromVisitNumber: closedVisit.visitNumber,
        toVisitId: nextVisit.id,
        toVisitNumber: nextVisit.visitNumber,
        carriedCount,
        items: incompleteSubtasks.map((i) => ({
          taskType: i.task.taskType,
          subtaskTitle: i.subtask.title,
          reason: i.subtask.incompletionReason,
        })),
      },
    },
  });

  return { carriedCount, nextVisitId: nextVisit.id };
}

// ─── Business Rule 2: Missed Weekly Visit auto-carry-forward ──────────────
//
// There is no cron/scheduler in this app, so this is implemented as a lazy,
// idempotent check that's invoked from the top of frequently-polled GET
// endpoints (GET /api/calendar, GET /api/admin/stats). Those pages already
// poll live via useLiveQuery (~every 25s + on focus/visibility), so gating
// this behind a per-process in-memory throttle keeps the check cheap:
// it only actually scans clients once per THROTTLE window, and every other
// poll in between is a no-op (a single Date.now() comparison). A DB-backed
// lock isn't needed — the function is fully idempotent (see the `notes`
// marker check below), so even if two processes raced past the throttle at
// the same moment, the marker check would prevent duplicate visits; the
// in-memory gate exists purely to avoid unnecessary work, not correctness.
let lastMissedWeeklyCheckAt = 0;
const MISSED_WEEKLY_CHECK_THROTTLE_MS = 15 * 60 * 1000; // 15 minutes

/** Monday 00:00:00.000 UTC of the week containing `d`. */
function getMondayUTC(d: Date): Date {
  const date = new Date(d);
  const dow = date.getUTCDay(); // 0 = Sun
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  date.setUTCDate(date.getUTCDate() + diffToMon);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

/**
 * Scan all active clients for weeks that fully elapsed with NO visit
 * scheduled at all, and auto-create a carry-forward Visit for the current
 * week on the client's usual weekday/time, reusing the same Task/Subtask
 * scaffolding logic used everywhere else (createVisitForClient) so there's
 * no duplicate task-creation logic.
 *
 * Idempotency: before creating, we check whether a Visit already exists for
 * this client whose `notes` contains the exact marker
 * `[CARRY-FORWARD: Missed Weekly Visit — week of <ISO date of that Monday>]`.
 * That marker is unique per (client, missed week), so this function can be
 * called any number of times and will only ever create ONE visit per missed
 * week per client.
 */
export async function checkAndCreateMissedWeeklyVisits(): Promise<{ checked: number; created: number }> {
  const now = Date.now();
  if (now - lastMissedWeeklyCheckAt < MISSED_WEEKLY_CHECK_THROTTLE_MS) {
    return { checked: 0, created: 0 };
  }
  lastMissedWeeklyCheckAt = now;

  // Only evaluate weeks that have FULLY elapsed — "last week" relative to
  // the start of the current (possibly in-progress) week. We never touch
  // the current week.
  const thisMonday = getMondayUTC(new Date());
  const lastMonday = new Date(thisMonday);
  lastMonday.setUTCDate(lastMonday.getUTCDate() - 7);
  const lastSunday = new Date(thisMonday);
  lastSunday.setUTCDate(lastSunday.getUTCDate() - 1);
  lastSunday.setUTCHours(23, 59, 59, 999);

  const missedWeekMarker = `${CARRY_FORWARD_NOTE_PREFIX} Missed Weekly Visit — week of ${lastMonday.toISOString().split("T")[0]}]`;

  // PERFORMANCE: previously this loop issued 3 sequential queries PER active
  // client (1 + 3N round-trips). On serverless the in-memory throttle resets
  // on every cold start, so dashboard/calendar loads regularly paid the full
  // scan and pages opened slowly. All the data needed to decide is now
  // fetched in 4 constant queries and evaluated in memory; only clients that
  // actually need a carry-forward visit created (rare) touch the DB again.
  const [activeClients, visitedLastWeekRows, handledRows, priorVisitRows, rescheduledAwayRows] = await Promise.all([
    prisma.client.findMany({
      where: { isArchived: false },
      select: { id: true, name: true },
    }),
    prisma.visit.findMany({
      where: { scheduledDate: { gte: lastMonday, lte: lastSunday } },
      select: { clientId: true },
      distinct: ["clientId"],
    }),
    prisma.visit.findMany({
      where: { notes: { contains: missedWeekMarker } },
      select: { clientId: true },
      distinct: ["clientId"],
    }),
    // Most recent visit BEFORE the missed week, per client
    prisma.visit.findMany({
      where: { scheduledDate: { lt: lastMonday } },
      orderBy: { scheduledDate: "desc" },
      select: { clientId: true, scheduledDate: true, executiveId: true },
      distinct: ["clientId"],
    }),
    // Visits rescheduled AWAY from some week with "Carry Forward: No" - the
    // vacated week was deliberately handled by the admin, not missed.
    prisma.visit.findMany({
      where: { notes: { contains: RESCHEDULED_FROM_NOTE_PREFIX } },
      select: { clientId: true, notes: true },
    }),
  ]);

  const visitedLastWeekSet = new Set(visitedLastWeekRows.map((r) => r.clientId));
  // Parse every "[RESCHEDULED-FROM: <ISO>]" marker; if the vacated date falls
  // inside the week being evaluated, count the client as handled.
  for (const row of rescheduledAwayRows) {
    const matches = row.notes?.matchAll(/\[RESCHEDULED-FROM: ([^\]]+)\]/g) ?? [];
    for (const m of matches) {
      const from = new Date(m[1]);
      if (!isNaN(from.getTime()) && from >= lastMonday && from <= lastSunday) {
        visitedLastWeekSet.add(row.clientId);
      }
    }
  }
  const handledSet = new Set(handledRows.map((r) => r.clientId));
  const priorVisitByClient = new Map(priorVisitRows.map((r) => [r.clientId, r]));

  let created = 0;

  for (const client of activeClients) {
    // Was this client visited (any visit scheduled) at all during last week?
    if (visitedLastWeekSet.has(client.id)) continue;

    // Idempotency guard — has this exact missed week already been handled?
    if (handledSet.has(client.id)) continue;

    // Infer the client's usual weekday/time/executive from their most
    // recent visit BEFORE the missed week. Clients with zero prior history
    // are skipped — there's no cadence to infer.
    const priorVisit = priorVisitByClient.get(client.id);
    if (!priorVisit) continue;

    const dow = priorVisit.scheduledDate.getUTCDay();
    const offsetFromMonday = dow === 0 ? 6 : dow - 1;
    const newScheduledDate = new Date(thisMonday);
    newScheduledDate.setUTCDate(thisMonday.getUTCDate() + offsetFromMonday);
    newScheduledDate.setUTCHours(
      priorVisit.scheduledDate.getUTCHours(),
      priorVisit.scheduledDate.getUTCMinutes(),
      priorVisit.scheduledDate.getUTCSeconds(),
      priorVisit.scheduledDate.getUTCMilliseconds()
    );

    // Reuse the shared visit-scaffolding helper (Tasks + Subtasks from
    // SubtaskTemplates) instead of duplicating that logic here. There's no
    // "system" user in the schema, so the client's own most-recent
    // executive is used as the acting user for the VISIT_CREATED log this
    // helper writes — it's the most contextually relevant real user.
    const { visitId } = await createVisitForClient(client.id, priorVisit.executiveId, priorVisit.executiveId, {
      scheduledDate: newScheduledDate,
      notes: missedWeekMarker,
      skipActiveDuplicateGuard: true,
    });

    await prisma.activityLog.create({
      data: {
        visitId,
        userId: priorVisit.executiveId,
        action: "CARRY_FORWARD_APPLIED",
        metadata: {
          reason: "MISSED_WEEKLY_VISIT",
          clientId: client.id,
          clientName: client.name,
          missedWeekStart: lastMonday.toISOString(),
          newVisitId: visitId,
        },
      },
    });

    created++;
  }

  return { checked: activeClients.length, created };
}

// ─── End-date-gated carry-forward sweep ─────────────────────────────────────
//
// Business rule: carry-forward must NOT happen the moment a visit is closed.
// It happens ONLY once the visit's end date has passed and incomplete
// subtasks remain. This sweep runs lazily (throttled, invoked from the
// frequently-hit GET endpoints like stats/calendar/carry-forward), finds all
// visits whose window has ended with unfinished work that hasn't been
// carried yet, and carries it into the SAME CLIENT's next visit (creating
// one when none exists). executeCarryForward is idempotent (sourceSubtaskId
// guard), so overlapping invocations can never produce duplicates.
let lastDueCarryForwardCheckAt = 0;
const DUE_CARRY_FORWARD_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes

export async function processDueCarryForwards(): Promise<{ processed: number; carried: number }> {
  const now = Date.now();
  if (now - lastDueCarryForwardCheckAt < DUE_CARRY_FORWARD_THROTTLE_MS) {
    return { processed: 0, carried: 0 };
  }
  lastDueCarryForwardCheckAt = now;

  // Candidate source visits: window potentially over, work potentially
  // unfinished. PENDING visits (never started) are intentionally excluded -
  // untouched weeks are handled by the missed-weekly rule, and carrying a
  // full untouched task list would duplicate the entire visit.
  const nowDate = new Date();
  const candidates = await prisma.visit.findMany({
    where: {
      status: { in: ["OPEN", "CLOSED"] },
      OR: [
        { endDate: { lt: nowDate } },
        // No explicit end date → the IST day of scheduledDate must be over.
        // Over-fetch slightly (scheduledDate < now) and filter precisely
        // in memory with hasEndDatePassed.
        { endDate: null, scheduledDate: { lt: nowDate } },
      ],
      tasks: { some: { subtasks: { some: { isCompleted: false } } } },
    },
    include: { tasks: { include: { subtasks: true } } },
    orderBy: { scheduledDate: "asc" },
    take: 50, // safety cap per sweep - the throttle re-runs regularly
  });

  let processed = 0;
  let carried = 0;

  for (const visit of candidates) {
    if (!hasEndDatePassed(visit, nowDate)) continue;
    // executeCarryForward internally skips subtasks that were already
    // carried; if everything was carried before, it's a cheap no-op.
    const result = await executeCarryForward(visit, visit.executiveId);
    processed++;
    carried += result.carriedCount;
  }

  return { processed, carried };
}

/**
 * Single maintenance entry point for read endpoints (stats, calendar,
 * carry-forward). Runs both lazy checks; each is individually throttled and
 * idempotent, so calling this on every request is safe and cheap.
 */
export async function runCarryForwardMaintenance(): Promise<void> {
  try {
    await checkAndCreateMissedWeeklyVisits();
  } catch (err) {
    console.error("[carry-forward] missed-weekly check failed:", err);
  }
  try {
    await processDueCarryForwards();
  } catch (err) {
    console.error("[carry-forward] due carry-forward sweep failed:", err);
  }
}
