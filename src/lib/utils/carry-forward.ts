import { prisma } from "@/lib/db/prisma";
import { Task, Subtask, Visit } from "@prisma/client";
import {
  createVisitForClient,
  CARRY_FORWARD_SUBTASKS_ONLY_MARKER,
  isSubtaskOnlyCarryForwardVisit,
  ensureCarryForwardVisitHasClientTasks,
} from "@/lib/utils/create-visit";
import { toMidnightIST } from "@/lib/utils/attendance";
import { applyAssignment, NormalizedAssignment } from "@/lib/utils/visit-assignment";

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

// Rule-2 marker — defined in create-visit.ts (which this module already
// imports) so that create-visit can use it without an import cycle.
// Re-exported here because carry-forward is its conceptual home.
export { CARRY_FORWARD_SUBTASKS_ONLY_MARKER, isSubtaskOnlyCarryForwardVisit };

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
// Every visit has a working window [scheduledDate .. endDate], and the END
// DATE IS A FULL WORKING DAY — the executive owns it until 23:59:59 IST.
// Carry-forward only becomes eligible AFTER that day is over.
//
// Both scheduledDate and endDate are stored as UTC midnight of the intended
// calendar day (that is what `new Date("2026-08-11")` produces from the date
// pickers). Treating the raw endDate as the boundary therefore ended the
// window at 00:00 UTC = 05:30 IST ON the end date itself, so a visit dated
// 11 Aug → 11 Aug was declared "over" at half past five in the morning of the
// 11th and its unfinished subtasks were flagged for carry-forward while the
// executive still had the whole day to do them.
//
// The boundary is therefore always the END of the IST calendar day that the
// end date falls on (midnight IST of the following day):
//   11 Aug → 11 Aug   ⇒ eligible from 12 Aug 00:00 IST
//   11 Aug → 13 Aug   ⇒ eligible from 14 Aug 00:00 IST
//   no end date       ⇒ end of the scheduledDate's own IST day
export function getEffectiveEndDate(visit: { scheduledDate: Date; endDate?: Date | null }): Date {
  const lastWorkingDay = visit.endDate ?? visit.scheduledDate;
  const dayStart = toMidnightIST(lastWorkingDay);
  return new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
}

export function hasEndDatePassed(visit: { scheduledDate: Date; endDate?: Date | null }, now = new Date()): boolean {
  return now.getTime() > getEffectiveEndDate(visit).getTime();
}

/**
 * The corresponding day exactly ONE WEEK after `date`, preserving the weekday
 * and the time of day: Wed 15 July 09:00 → Wed 22 July 09:00.
 *
 * This is the destination rule for subtask carry-forward. Adding 7 days is
 * what guarantees both required properties at once — the weekday is preserved
 * (7 ≡ 0 mod 7) and the result can never fall inside the source visit's own
 * week — which is why the offset is fixed at 7 rather than "the next visit
 * after this one".
 */
export function getNextWeekSameWeekday(date: Date): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + 7);
  return next;
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

  // ── Destination: NEXT WEEK, SAME WEEKDAY ─────────────────────────────────
  // Carry-forward must never land inside the source visit's own week. The
  // destination is the corresponding day one week later (Wed 15th → Wed 22nd),
  // which is the app's existing weekly cadence. Previously this took the
  // client's next PENDING/OPEN visit by date, which could easily be Thursday
  // or Friday of the SAME week.
  const targetDate = getNextWeekSameWeekday(closedVisit.scheduledDate);
  const targetDayStart = toMidnightIST(targetDate);
  const targetDayEnd = new Date(targetDayStart.getTime() + 24 * 60 * 60 * 1000);

  // Reuse the client's real visit for that day if one is already scheduled -
  // the carried subtasks then sit alongside that visit's normal task list.
  let nextVisit = await prisma.visit.findFirst({
    where: {
      clientId: closedVisit.clientId,
      status: { in: ["PENDING", "OPEN"] },
      scheduledDate: { gte: targetDayStart, lt: targetDayEnd },
      id: { not: closedVisit.id },
    },
    orderBy: { scheduledDate: "asc" },
    include: {
      tasks: {
        include: { subtasks: true },
      },
    },
  });

  // Nothing scheduled that day? Create a carry-forward-only visit so the
  // incomplete subtasks are NEVER silently dropped.
  //
  // skipTaskScaffolding is what fixes the "whole visit was duplicated" bug:
  // this visit starts EMPTY and receives only the incomplete subtasks below,
  // grouped under the main tasks they came from. It must not be pre-filled
  // with the client's full task configuration.
  //
  // skipActiveDuplicateGuard is REQUIRED here: at this point the visit being
  // closed is still status=OPEN in the DB, so the duplicate guard would
  // return the closing visit itself and we'd carry subtasks into the very
  // visit that is being closed.
  if (!nextVisit) {
    const { visitId } = await createVisitForClient(
      closedVisit.clientId,
      closedVisit.executiveId,
      closedByUserId,
      {
        scheduledDate: targetDate,
        // Both markers: the first drives the existing carry-forward badge, the
        // second pins this visit as Rule 2 so nothing ever scaffolds it.
        notes: `${CARRY_FORWARD_NOTE_PREFIX} Incomplete items from ${closedVisit.visitNumber}] ${CARRY_FORWARD_SUBTASKS_ONLY_MARKER}`,
        skipActiveDuplicateGuard: true,
        skipTaskScaffolding: true,
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

  // The carried subtasks are in place. If this is a carry-forward-only visit
  // that stands in for the client's visit that week, it also has to carry the
  // client's configured main tasks and subtasks — otherwise the executive is
  // sent to the client with only the missed items and none of the ordinary
  // checklist. Additive, and a no-op for a visit that was reused rather than
  // created (that one already has its normal task list).
  await ensureCarryForwardVisitHasClientTasks(nextVisit.id);

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
  // ─── DISABLED (§7): the application must not create carry-forward visits ───
  // This rule used to auto-create a "Missed Weekly Visit" for any client whose
  // week elapsed with no visit. Carry-forward is now entirely admin-approved,
  // so nothing may be created automatically. Kept as a no-op so the existing
  // callers and their error handling stay untouched.
  return { checked: 0, created: 0 };
}

/** Retained for reference/testing; no longer invoked by the running app. */
export async function legacyCheckAndCreateMissedWeeklyVisits(): Promise<{ checked: number; created: number }> {
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
  // End of the destination week (the current week), used by the duplicate
  // guard below.
  const thisSunday = new Date(thisMonday);
  thisSunday.setUTCDate(thisSunday.getUTCDate() + 6);
  thisSunday.setUTCHours(23, 59, 59, 999);

  const [
    activeClients,
    visitedLastWeekRows,
    handledRows,
    priorVisitRows,
    rescheduledAwayRows,
    visitedThisWeekRows,
  ] = await Promise.all([
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
    // Clients that ALREADY have a visit in the destination week. Rule 1 must
    // not add a second one on top of it — that would be a duplicate
    // carry-forward visit for the same week.
    prisma.visit.findMany({
      where: { scheduledDate: { gte: thisMonday, lte: thisSunday } },
      select: { clientId: true },
      distinct: ["clientId"],
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
  const visitedThisWeekSet = new Set(visitedThisWeekRows.map((r) => r.clientId));
  const priorVisitByClient = new Map(priorVisitRows.map((r) => [r.clientId, r]));

  let created = 0;

  for (const client of activeClients) {
    // Was this client visited (any visit scheduled) at all during last week?
    if (visitedLastWeekSet.has(client.id)) continue;

    // Idempotency guard — has this exact missed week already been handled?
    if (handledSet.has(client.id)) continue;

    // Duplicate guard — a visit already exists in the destination week, so the
    // client's work for that week is already represented. Reuse it rather than
    // creating a second, competing visit.
    if (visitedThisWeekSet.has(client.id)) continue;

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
  // ─── Automatic carry-forward is DISABLED (§7) ──────────────────────────────
  // The application must never create or approve carry-forward on its own.
  // Instead, `markDueCarryForwardRequests()` flags eligible incomplete
  // subtasks as PENDING requests, and an admin approves them from the
  // Admin → Carry Forward page, which is what actually creates the carried
  // copies (see approveCarryForward()).
  //
  // The function is kept — rather than deleted — so every existing caller
  // keeps working; it now only marks requests and never writes carried rows.
  const marked = await markDueCarryForwardRequests();
  return { processed: marked.marked, carried: 0 };
}

/**
 * Flag incomplete subtasks on finished visits as PENDING carry-forward
 * requests. Marking is idempotent and creates NOTHING — no visits, no carried
 * subtasks — it only records that an item is awaiting an admin decision.
 */
export async function markDueCarryForwardRequests(): Promise<{ marked: number }> {
  const now = Date.now();
  if (now - lastDueCarryForwardCheckAt < DUE_CARRY_FORWARD_THROTTLE_MS) {
    return { marked: 0 };
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

  // Collect the incomplete subtasks whose visit window is genuinely over and
  // that are not already requested/approved/rejected, then flag them in one
  // write. No visit and no carried subtask is created here.
  const toMark: string[] = [];
  for (const visit of candidates) {
    if (!hasEndDatePassed(visit, nowDate)) continue;
    for (const task of visit.tasks) {
      for (const subtask of task.subtasks) {
        if (subtask.isCompleted) continue;
        // Already carried elsewhere, or already decided — leave alone.
        if (subtask.isCarriedForward) continue;
        if (subtask.carryForwardRequestedAt || subtask.carryForwardApprovedAt || subtask.carryForwardRejectedAt) continue;
        toMark.push(subtask.id);
      }
    }
  }

  if (toMark.length > 0) {
    await prisma.subtask.updateMany({
      where: { id: { in: toMark } },
      data: { carryForwardRequestedAt: nowDate },
    });
  }

  return { marked: toMark.length };
}

// ─── Admin-approved carry-forward (§7 + §8) ──────────────────────────────────

export interface ApproveCarryForwardResult {
  approved: number;
  skipped: number;
  /** Visits that received carried subtasks, and whether each already existed. */
  destinations: { visitId: string; visitNumber: string; created: boolean }[];
  errors: string[];
}

export interface ApproveCarryForwardOptions {
  /**
   * §5 — the admin may re-assign the work while approving it. When present,
   * the destination visit is put on this SOLO/TEAM assignment through the
   * app's single assignment path (applyAssignment), so the approved carry-
   * forward is owned by exactly the executive/team the admin picked.
   * Omitted → the destination keeps whatever assignment it already had, and a
   * newly created destination inherits the previous executive.
   */
  assignment?: NormalizedAssignment;
}

/**
 * Approve carry-forward for specific subtasks and place them on the chosen
 * destination date.
 *
 * §8: if the client ALREADY has a visit on the destination date, the carried
 * subtasks are added into that existing visit — a second visit is never
 * created. A visit is only created when the client has none on that date.
 *
 * Duplicate protection is threefold: the subtask must still be a pending
 * request, the destination task must not already hold a pending carried copy
 * with the same title, and @@unique([taskId, sourceSubtaskId]) is the final
 * database-level guard.
 */
export async function approveCarryForward(
  subtaskIds: string[],
  destinationDate: Date,
  approvedByUserId: string,
  options: ApproveCarryForwardOptions = {}
): Promise<ApproveCarryForwardResult> {
  const result: ApproveCarryForwardResult = { approved: 0, skipped: 0, destinations: [], errors: [] };
  if (subtaskIds.length === 0) return result;

  const subtasks = await prisma.subtask.findMany({
    where: { id: { in: subtaskIds } },
    include: {
      task: {
        include: {
          visit: { select: { id: true, clientId: true, executiveId: true, visitNumber: true } },
        },
      },
    },
  });

  const dayStart = toMidnightIST(destinationDate);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  // Group by client so each client's destination visit is resolved once.
  const byClient = new Map<string, typeof subtasks>();
  for (const s of subtasks) {
    if (s.isCompleted) { result.skipped++; continue; }
    if (s.carryForwardApprovedAt) { result.skipped++; continue; }
    const key = s.task.visit.clientId;
    if (!byClient.has(key)) byClient.set(key, []);
    byClient.get(key)!.push(s);
  }

  for (const [clientId, items] of byClient.entries()) {
    try {
      // §5 — whoever the admin selected owns the approved work; with no
      // re-assignment the executive the work came from keeps it.
      const targetExecutiveId = options.assignment?.leadId ?? items[0].task.visit.executiveId;

      // §8 — reuse the client's existing visit on the destination date, but
      // only one that ALREADY BELONGS TO THE TARGET EXECUTIVE (as owner/lead
      // or as a team member). The reuse rule exists to stop a duplicate visit
      // appearing for that executive on that day — it must never reach across
      // to a DIFFERENT executive's visit for the same client, because the
      // approval would then either drop the work into someone else's queue or,
      // when a re-assignment is supplied, hand that executive's whole visit
      // (its ordinary tasks included) to the newly selected one. When only
      // another executive holds the day, the target gets their own visit below.
      let destination = await prisma.visit.findFirst({
        where: {
          clientId,
          scheduledDate: { gte: dayStart, lt: dayEnd },
          status: { in: ["PENDING", "OPEN"] },
          OR: [
            { executiveId: targetExecutiveId },
            { assignments: { some: { executiveId: targetExecutiveId } } },
          ],
        },
        orderBy: { scheduledDate: "asc" },
        include: { tasks: { include: { subtasks: true } } },
      });
      let createdVisit = false;

      if (!destination) {
        const { visitId } = await createVisitForClient(
          clientId,
          targetExecutiveId,
          approvedByUserId,
          {
            scheduledDate: destinationDate,
            notes: `${CARRY_FORWARD_NOTE_PREFIX} Approved by admin] ${CARRY_FORWARD_SUBTASKS_ONLY_MARKER}`,
            skipActiveDuplicateGuard: true,
            skipTaskScaffolding: true,
          }
        );
        destination = await prisma.visit.findUnique({
          where: { id: visitId },
          include: { tasks: { include: { subtasks: true } } },
        });
        createdVisit = true;
      }
      if (!destination) { result.errors.push("Could not resolve a destination visit"); continue; }

      // §5 — apply the admin's Solo/Team choice to the destination visit. This
      // goes through the same applyAssignment used by every other assignment
      // surface, so the visit row, its team rows and the lead-only close rule
      // stay consistent; the visit itself is never recreated, so an existing
      // destination keeps its id, its normal tasks and their completion.
      if (options.assignment) {
        await applyAssignment(prisma, destination.id, options.assignment);
      }

      for (const item of items) {
        // Find (or create) the matching main task on the destination visit so
        // the carried subtask lands under the same main task it came from.
        let target = destination.tasks.find((t) => t.taskType === item.task.taskType);
        if (!target) {
          const maxOrder = destination.tasks.reduce((m, t) => Math.max(m, t.orderIndex), -1);
          const created = await prisma.task.create({
            data: {
              visitId: destination.id,
              taskType: item.task.taskType,
              title: item.task.title,
              status: "PENDING",
              orderIndex: maxOrder + 1,
            },
          });
          target = { ...created, subtasks: [] };
          destination.tasks.push(target);
        }

        const cleanTitle = item.title.replace("[CARRY-FORWARD] ", "");
        const duplicate = target.subtasks.some(
          (s) => s.isCarriedForward && !s.isCompleted && s.title.replace("[CARRY-FORWARD] ", "") === cleanTitle
        );
        if (duplicate) { result.skipped++; continue; }

        try {
          const carried = await prisma.subtask.create({
            data: {
              taskId: target.id,
              title: `[CARRY-FORWARD] ${cleanTitle}`,
              isCompleted: false,
              isCarriedForward: true,
              sourceSubtaskId: item.id,
            },
          });
          target.subtasks.push(carried);
          await prisma.subtask.update({
            where: { id: item.id },
            data: {
              carryForwardApprovedAt: new Date(),
              carryForwardApprovedById: approvedByUserId,
              carryForwardRejectedAt: null,
            },
          });
          result.approved++;
        } catch (err) {
          // P2002 = the unique guard fired; the item was already carried.
          if ((err as { code?: string })?.code === "P2002") { result.skipped++; continue; }
          throw err;
        }
      }

      // Same rule as executeCarryForward: an approved carry-forward that had
      // to create its own visit must still carry the client's configured work
      // when that visit is the client's only one for the week. No-op when an
      // existing visit was reused.
      await ensureCarryForwardVisitHasClientTasks(destination.id);

      result.destinations.push({
        visitId: destination.id,
        visitNumber: destination.visitNumber,
        created: createdVisit,
      });

      await prisma.activityLog.create({
        data: {
          visitId: destination.id,
          userId: approvedByUserId,
          action: "CARRY_FORWARD_APPLIED",
          metadata: {
            reason: "ADMIN_APPROVED",
            destinationDate: destinationDate.toISOString(),
            reusedExistingVisit: !createdVisit,
            itemCount: items.length,
          },
        },
      });
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return result;
}

// ─── Admin: change executive / team / date of ALREADY-CARRIED work (§7) ──────

export interface MoveCarryForwardResult {
  moved: number;
  skipped: number;
  destinations: { visitId: string; visitNumber: string; created: boolean }[];
  errors: string[];
}

/**
 * Re-target carry-forward tasks that have ALREADY been carried: change the
 * destination date, the assigned executive/team, or both.
 *
 * The rules that make this safe:
 *   • Per client. A client's carried task can only ever land on that same
 *     client's visit.
 *   • The carried ROW is moved, never copied — no duplicate is produced and
 *     `sourceSubtaskId` (its link back to the original) is untouched, so the
 *     carry-forward history stays traceable.
 *   • The ORIGINAL subtask, its visit, the main task and the client's task
 *     configuration are never written to.
 *   • Re-assignment never rewrites a visit that also holds normal work: if a
 *     new assignment is requested, the destination is a carry-forward-only
 *     visit (an existing one for that client/date, or a new one), so the
 *     client's ordinary tasks are never silently reassigned with it. Without
 *     an assignment change the task joins the client's existing visit for the
 *     date exactly as §3 requires.
 *   • A carry-forward-only holder visit left completely empty by the move is
 *     removed, so the work stops appearing under the previous executive.
 */
export async function moveCarryForward(
  subtaskIds: string[],
  options: { destinationDate?: Date; assignment?: NormalizedAssignment },
  actingUserId: string
): Promise<MoveCarryForwardResult> {
  const result: MoveCarryForwardResult = { moved: 0, skipped: 0, destinations: [], errors: [] };
  if (subtaskIds.length === 0) return result;

  const rows = await prisma.subtask.findMany({
    where: { id: { in: subtaskIds }, isCarriedForward: true },
    include: {
      task: {
        include: {
          visit: { select: { id: true, clientId: true, executiveId: true, visitNumber: true, scheduledDate: true, status: true, notes: true } },
        },
      },
    },
  });

  const byClient = new Map<string, typeof rows>();
  for (const s of rows) {
    if (s.isCompleted) { result.skipped++; continue; }
    if (s.task.visit.status === "CLOSED") { result.skipped++; continue; }
    const key = s.task.visit.clientId;
    if (!byClient.has(key)) byClient.set(key, []);
    byClient.get(key)!.push(s);
  }

  for (const [clientId, items] of byClient.entries()) {
    try {
      const sourceVisitIds = [...new Set(items.map((i) => i.task.visit.id))];
      const targetDate = options.destinationDate ?? items[0].task.visit.scheduledDate;
      const dayStart = toMidnightIST(targetDate);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

      const sameDay = await prisma.visit.findMany({
        where: { clientId, scheduledDate: { gte: dayStart, lt: dayEnd }, status: { in: ["PENDING", "OPEN"] } },
        include: { tasks: { include: { subtasks: true } } },
        orderBy: { scheduledDate: "asc" },
      });

      // With a new assignment we may only take over a carry-forward-only
      // visit; otherwise we would reassign the client's normal tasks too.
      let destination = options.assignment
        ? sameDay.find((v) => isSubtaskOnlyCarryForwardVisit(v)) ?? null
        : sameDay.find((v) => !isSubtaskOnlyCarryForwardVisit(v)) ?? sameDay[0] ?? null;
      let createdVisit = false;

      if (!destination) {
        const { visitId } = await createVisitForClient(
          clientId,
          options.assignment?.leadId ?? items[0].task.visit.executiveId,
          actingUserId,
          {
            scheduledDate: targetDate,
            endDate: targetDate,
            notes: `${CARRY_FORWARD_NOTE_PREFIX} Rescheduled by admin] ${CARRY_FORWARD_SUBTASKS_ONLY_MARKER}`,
            skipActiveDuplicateGuard: true,
            skipTaskScaffolding: true,
          }
        );
        destination = await prisma.visit.findUnique({
          where: { id: visitId },
          include: { tasks: { include: { subtasks: true } } },
        });
        createdVisit = true;
      }
      if (!destination) { result.errors.push("Could not resolve a destination visit"); continue; }

      if (options.assignment) {
        await applyAssignment(prisma, destination.id, options.assignment);
      }

      for (const item of items) {
        // Already sitting where it should be — only the assignment/date of the
        // holding visit changed, which is handled above.
        if (item.task.visitId === destination.id) { result.moved++; continue; }

        let target = destination.tasks.find((t) => t.taskType === item.task.taskType);
        if (!target) {
          const maxOrder = destination.tasks.reduce((m, t) => Math.max(m, t.orderIndex), -1);
          const created = await prisma.task.create({
            data: {
              visitId: destination.id,
              taskType: item.task.taskType,
              title: item.task.title,
              status: "PENDING",
              orderIndex: maxOrder + 1,
            },
          });
          target = { ...created, subtasks: [] };
          destination.tasks.push(target);
        }
        // MOVE the existing row: no new subtask is created, so the task is
        // never duplicated and its source link survives.
        await prisma.subtask.update({ where: { id: item.id }, data: { taskId: target.id } });
        result.moved++;
      }

      // Same rule again: a destination visit created for this reschedule must
      // carry the client's configured work when it is their only visit that
      // week. No-op when an existing visit was taken over.
      await ensureCarryForwardVisitHasClientTasks(destination.id);

      result.destinations.push({ visitId: destination.id, visitNumber: destination.visitNumber, created: createdVisit });

      // Drop carry-forward-only holders that the move emptied, so the previous
      // executive is not left with a phantom visit.
      for (const vid of sourceVisitIds) {
        if (vid === destination.id) continue;
        const source = await prisma.visit.findUnique({
          where: { id: vid },
          include: { tasks: { include: { subtasks: true } } },
        });
        if (!source || !isSubtaskOnlyCarryForwardVisit(source)) continue;
        if (source.tasks.some((t) => t.subtasks.length > 0)) continue;
        await prisma.activityLog.deleteMany({ where: { visitId: vid } });
        await prisma.visitReassignment.deleteMany({ where: { visitId: vid } });
        await prisma.visitDelegation.deleteMany({ where: { visitId: vid } });
        await prisma.visit.delete({ where: { id: vid } });
      }

      await prisma.activityLog.create({
        data: {
          visitId: destination.id,
          userId: actingUserId,
          action: "CARRY_FORWARD_APPLIED",
          metadata: {
            reason: "ADMIN_RESCHEDULED",
            destinationDate: targetDate.toISOString(),
            reassigned: !!options.assignment,
            itemCount: items.length,
          },
        },
      });
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return result;
}

/** Reject carry-forward requests so they stop appearing as pending. */
export async function rejectCarryForward(subtaskIds: string[]): Promise<{ rejected: number }> {
  if (subtaskIds.length === 0) return { rejected: 0 };
  const res = await prisma.subtask.updateMany({
    where: { id: { in: subtaskIds }, carryForwardApprovedAt: null },
    data: { carryForwardRejectedAt: new Date() },
  });
  return { rejected: res.count };
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
