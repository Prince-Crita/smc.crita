/**
 * Data-integrity diagnostics for the Super Admin (§8).
 *
 * This module DETECTS and EXPLAINS. It never writes. Nothing here "repairs"
 * data as a side effect of looking at it — an inconsistency is reported with
 * enough context for a human to judge it, and any correction is made
 * deliberately through the audited records endpoint, where it is recorded and
 * can be undone.
 *
 * Every check is bounded (`take`), so running the page cannot turn into a full
 * table scan of the operational tables.
 */
import { prisma } from "@/lib/db/prisma";
import { toMidnightIST } from "@/lib/utils/attendance";

export type Severity = "critical" | "warning" | "info";

export interface HealthItem {
  /** Entity + id the Records explorer can open. */
  entity: string;
  id: string;
  label: string;
  detail: string;
  /** A correction the Super Admin can apply through the audited PATCH path. */
  fix?: { patch: Record<string, unknown>; describe: string };
}

export interface HealthCheck {
  key: string;
  title: string;
  severity: Severity;
  /** What this check looks for, in plain language. */
  explanation: string;
  /** What a Super Admin should do about it. */
  guidance: string;
  count: number;
  items: HealthItem[];
}

const LIMIT = 25;
const day = (d: Date) =>
  new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export async function runHealthChecks(): Promise<{
  checks: HealthCheck[];
  totals: { critical: number; warning: number; info: number; issues: number };
  generatedAt: string;
}> {
  const checks: HealthCheck[] = [];
  const now = new Date();
  const today = toMidnightIST(now);

  // ── 1. Invalid assignments ────────────────────────────────────────────────
  // The invariant the whole Solo/Team model rests on: a TEAM visit has a LEAD
  // row matching Visit.executiveId plus at least one MEMBER; a SOLO visit has
  // no assignment rows at all.
  const teamVisits = await prisma.visit.findMany({
    where: { visitType: "TEAM" },
    select: {
      id: true, visitNumber: true, executiveId: true, scheduledDate: true,
      client: { select: { name: true } },
      assignments: { select: { executiveId: true, role: true } },
    },
    take: 500,
  });
  const badTeam: HealthItem[] = [];
  for (const v of teamVisits) {
    const lead = v.assignments.find((a) => a.role === "LEAD");
    const members = v.assignments.filter((a) => a.role !== "LEAD");
    const problems: string[] = [];
    if (!lead) problems.push("no LEAD row");
    else if (lead.executiveId !== v.executiveId) problems.push("LEAD row does not match the visit owner");
    if (members.length === 0) problems.push("no team members");
    if (problems.length > 0) {
      badTeam.push({
        entity: "visits", id: v.id,
        label: `${v.visitNumber} · ${v.client.name}`,
        detail: `Team visit with ${problems.join(" and ")}.`,
      });
    }
  }
  const soloWithRows = await prisma.visit.findMany({
    where: { visitType: "SOLO", assignments: { some: {} } },
    select: {
      id: true, visitNumber: true, client: { select: { name: true } },
      _count: { select: { assignments: true } },
    },
    take: LIMIT,
  });
  for (const v of soloWithRows) {
    badTeam.push({
      entity: "visits", id: v.id,
      label: `${v.visitNumber} · ${v.client.name}`,
      detail: `Solo visit still carrying ${v._count.assignments} team assignment row(s).`,
    });
  }
  checks.push({
    key: "invalid-assignments",
    title: "Invalid visit assignments",
    severity: "critical",
    explanation:
      "A Team visit must have a LEAD row matching the visit owner and at least one member; a Solo visit must have no assignment rows.",
    guidance:
      "Re-apply the assignment on the visit (Solo/Team picker). That rewrites the rows through the normal workflow without recreating the visit or touching its tasks.",
    count: badTeam.length,
    items: badTeam.slice(0, LIMIT),
  });

  // ── 2. Duplicate visits ───────────────────────────────────────────────────
  // More than one active visit for the same client on the same day is the
  // duplicate the carry-forward reuse rule exists to prevent.
  const dupRows = await prisma.$queryRaw<Array<{ clientId: string; d: Date; n: bigint }>>`
    SELECT "clientId", date_trunc('day', "scheduledDate") AS d, COUNT(*) AS n
    FROM visits
    WHERE status IN ('PENDING', 'OPEN')
    GROUP BY "clientId", date_trunc('day', "scheduledDate")
    HAVING COUNT(*) > 1
    LIMIT 25
  `;
  const dupItems: HealthItem[] = [];
  for (const r of dupRows) {
    const vs = await prisma.visit.findMany({
      where: {
        clientId: r.clientId,
        status: { in: ["PENDING", "OPEN"] },
        scheduledDate: { gte: r.d, lt: new Date(new Date(r.d).getTime() + 24 * 60 * 60 * 1000) },
      },
      select: {
        id: true, visitNumber: true, notes: true,
        client: { select: { name: true } },
        _count: { select: { tasks: true } },
      },
    });
    for (const v of vs) {
      dupItems.push({
        entity: "visits", id: v.id,
        label: `${v.visitNumber} · ${v.client.name}`,
        detail: `${Number(r.n)} active visits for this client on ${day(r.d)} (this one has ${v._count.tasks} task(s)).`,
      });
    }
  }
  checks.push({
    key: "duplicate-visits",
    title: "Duplicate visits",
    severity: "warning",
    explanation: "Two or more active (Pending/In Progress) visits exist for the same client on the same day.",
    guidance:
      "Open both and check which one holds the real work. Cancel the empty one rather than deleting it, so its history survives.",
    count: dupItems.length,
    items: dupItems.slice(0, LIMIT),
  });

  // ── 3. Orphaned / empty visits ────────────────────────────────────────────
  const emptyVisits = await prisma.visit.findMany({
    where: { status: { in: ["PENDING", "OPEN"] }, tasks: { none: {} } },
    select: {
      id: true, visitNumber: true, scheduledDate: true, notes: true,
      client: { select: { name: true } },
    },
    take: LIMIT,
  });
  const emptyTaskVisits = await prisma.visit.findMany({
    where: { status: { in: ["PENDING", "OPEN"] }, tasks: { every: { subtasks: { none: {} } } }, NOT: { tasks: { none: {} } } },
    select: { id: true, visitNumber: true, scheduledDate: true, client: { select: { name: true } } },
    take: LIMIT,
  });
  checks.push({
    key: "orphaned-visits",
    title: "Empty visits",
    severity: "warning",
    explanation:
      "An active visit with no tasks at all, or whose tasks hold no subtasks — usually a leftover shell after work was moved elsewhere.",
    guidance:
      "Confirm the work really lives on another visit, then cancel the shell. Do not delete it if it carries history.",
    count: emptyVisits.length + emptyTaskVisits.length,
    items: [
      ...emptyVisits.map((v) => ({
        entity: "visits", id: v.id,
        label: `${v.visitNumber} · ${v.client.name}`,
        detail: `No tasks. Scheduled ${day(v.scheduledDate)}.`,
      })),
      ...emptyTaskVisits.map((v) => ({
        entity: "visits", id: v.id,
        label: `${v.visitNumber} · ${v.client.name}`,
        detail: `Tasks exist but hold no subtasks. Scheduled ${day(v.scheduledDate)}.`,
      })),
    ].slice(0, LIMIT),
  });

  // ── 4. Inactive users still holding work ──────────────────────────────────
  const inactiveWithWork = await prisma.user.findMany({
    where: {
      isActive: false,
      OR: [
        { assignedVisits: { some: { status: { in: ["PENDING", "OPEN"] } } } },
        { teamAssignments: { some: { visit: { status: { in: ["PENDING", "OPEN"] } } } } },
      ],
    },
    select: {
      id: true, name: true, role: true,
      _count: { select: { assignedVisits: true, teamAssignments: true } },
    },
    take: LIMIT,
  });
  checks.push({
    key: "inactive-users-with-work",
    title: "Deactivated users still assigned",
    severity: "critical",
    explanation: "A deactivated account still owns or is a member of active visits, so that work has nobody who can sign in to do it.",
    guidance: "Either reassign those visits to an active executive, or reactivate the account.",
    count: inactiveWithWork.length,
    items: inactiveWithWork.map((u) => ({
      entity: "users", id: u.id,
      label: `${u.name} (${u.role})`,
      detail: `Deactivated, but owns ${u._count.assignedVisits} visit(s) and is a member of ${u._count.teamAssignments}.`,
      fix: { patch: { isActive: true }, describe: "Reactivate this account" },
    })),
  });

  // ── 5. Incorrect statuses ─────────────────────────────────────────────────
  const [closedNoTimestamp, openWithClosedAt, taskDoneWithPending] = await Promise.all([
    prisma.visit.findMany({
      where: { status: "CLOSED", closedAt: null },
      select: { id: true, visitNumber: true, client: { select: { name: true } } },
      take: LIMIT,
    }),
    prisma.visit.findMany({
      where: { status: { in: ["PENDING", "OPEN"] }, closedAt: { not: null } },
      select: { id: true, visitNumber: true, status: true, closedAt: true, client: { select: { name: true } } },
      take: LIMIT,
    }),
    prisma.task.findMany({
      where: { status: "COMPLETED", subtasks: { some: { isCompleted: false } } },
      select: {
        id: true, title: true,
        visit: { select: { visitNumber: true, client: { select: { name: true } } } },
        _count: { select: { subtasks: true } },
      },
      take: LIMIT,
    }),
  ]);
  checks.push({
    key: "inconsistent-status",
    title: "Inconsistent statuses",
    severity: "warning",
    explanation:
      "A visit marked Closed with no closed-at time, an open visit that already carries one, or a task marked Completed while it still has incomplete subtasks.",
    guidance:
      "Correct the status only where it is genuinely wrong. Correcting a status here does not change any subtask the executive recorded.",
    count: closedNoTimestamp.length + openWithClosedAt.length + taskDoneWithPending.length,
    items: [
      ...closedNoTimestamp.map((v) => ({
        entity: "visits", id: v.id, label: `${v.visitNumber} · ${v.client.name}`,
        detail: "Marked Closed but has no closed-at timestamp.",
      })),
      ...openWithClosedAt.map((v) => ({
        entity: "visits", id: v.id, label: `${v.visitNumber} · ${v.client.name}`,
        detail: `Status is ${v.status} but a closed-at time is set (${day(v.closedAt!)}).`,
      })),
      ...taskDoneWithPending.map((t) => ({
        entity: "tasks", id: t.id, label: `${t.title} · ${t.visit.client.name}`,
        detail: `Task is Completed on ${t.visit.visitNumber} but still has incomplete subtasks.`,
      })),
    ].slice(0, LIMIT),
  });

  // ── 6. Invalid carry-forward references ───────────────────────────────────
  const [carriedNoSource, approvedAndRejected, requestedOnClosedApproved] = await Promise.all([
    prisma.subtask.findMany({
      where: { isCarriedForward: true, sourceSubtaskId: null },
      select: {
        id: true, title: true,
        task: { select: { visit: { select: { visitNumber: true, client: { select: { name: true } } } } } },
      },
      take: LIMIT,
    }),
    prisma.subtask.findMany({
      where: { carryForwardApprovedAt: { not: null }, carryForwardRejectedAt: { not: null } },
      select: {
        id: true, title: true, carryForwardApprovedAt: true, carryForwardRejectedAt: true,
        task: { select: { visit: { select: { visitNumber: true, client: { select: { name: true } } } } } },
      },
      take: LIMIT,
    }),
    prisma.subtask.findMany({
      where: { carryForwardApprovedAt: { not: null }, carriedSubtasks: { none: {} } },
      select: {
        id: true, title: true, carryForwardApprovedAt: true,
        task: { select: { visit: { select: { visitNumber: true, client: { select: { name: true } } } } } },
      },
      take: LIMIT,
    }),
  ]);
  checks.push({
    key: "invalid-carry-forward",
    title: "Invalid carry-forward references",
    severity: "critical",
    explanation:
      "A carried subtask with no source it came from, a request that is both approved and rejected, or an approved request with no carried copy anywhere.",
    guidance:
      "Check the item on the Carry Forward page before changing anything — the relationship, not the flag, is what the executive's screen follows.",
    count: carriedNoSource.length + approvedAndRejected.length + requestedOnClosedApproved.length,
    items: [
      ...carriedNoSource.map((s) => ({
        entity: "carry-forward", id: s.id,
        label: `${s.title} · ${s.task.visit.client.name}`,
        detail: `Marked carried forward on ${s.task.visit.visitNumber} but has no source subtask.`,
      })),
      ...approvedAndRejected.map((s) => ({
        entity: "carry-forward", id: s.id,
        label: `${s.title} · ${s.task.visit.client.name}`,
        detail: `Both approved (${day(s.carryForwardApprovedAt!)}) and rejected (${day(s.carryForwardRejectedAt!)}).`,
      })),
      ...requestedOnClosedApproved.map((s) => ({
        entity: "carry-forward", id: s.id,
        label: `${s.title} · ${s.task.visit.client.name}`,
        detail: `Approved on ${day(s.carryForwardApprovedAt!)} but no carried copy exists.`,
      })),
    ].slice(0, LIMIT),
  });

  // ── 7. Attendance inconsistencies ─────────────────────────────────────────
  const openPunches = await prisma.attendance.findMany({
    where: { punchOut: null, date: { lt: today } },
    select: { id: true, date: true, punchIn: true, executive: { select: { name: true } } },
    orderBy: { date: "desc" },
    take: LIMIT,
  });
  const reversed = await prisma.$queryRaw<Array<{ id: string; name: string; date: Date }>>`
    SELECT a.id, u.name, a.date
    FROM attendance a JOIN users u ON u.id = a."executiveId"
    WHERE a."punchOut" IS NOT NULL AND a."punchOut" < a."punchIn"
    LIMIT 25
  `;
  checks.push({
    key: "attendance-inconsistencies",
    title: "Attendance inconsistencies",
    severity: "warning",
    explanation: "A punch-in on a past day that was never punched out, or a punch-out recorded before its punch-in.",
    guidance:
      "Attendance is the executive's own record — review it with them. It is shown read-only here so a punch is never silently rewritten.",
    count: openPunches.length + reversed.length,
    items: [
      ...openPunches.map((a) => ({
        entity: "attendance", id: a.id,
        label: a.executive.name,
        detail: `Punched in on ${day(a.date)} and never punched out.`,
      })),
      ...reversed.map((a) => ({
        entity: "attendance", id: a.id,
        label: a.name,
        detail: `Punch-out is earlier than punch-in on ${day(a.date)}.`,
      })),
    ].slice(0, LIMIT),
  });

  // ── 8. Missing client relationships ───────────────────────────────────────
  const [noConfig, noExec] = await Promise.all([
    prisma.client.findMany({
      where: { isArchived: false, taskTypeConfigs: { none: {} } },
      select: { id: true, name: true, code: true },
      take: LIMIT,
    }),
    prisma.client.findMany({
      where: { isArchived: false, assignedExecId: null, visits: { some: { status: { in: ["PENDING", "OPEN"] } } } },
      select: { id: true, name: true, code: true },
      take: LIMIT,
    }),
  ]);
  checks.push({
    key: "missing-client-relationships",
    title: "Incomplete client setup",
    severity: "info",
    explanation: "An active client with no task-type configuration, or with active visits but no assigned executive.",
    guidance: "Complete the client's setup on the Clients page — the existing Task Config and assignment workflows.",
    count: noConfig.length + noExec.length,
    items: [
      ...noConfig.map((c) => ({
        entity: "clients", id: c.id, label: `${c.name} (${c.code})`,
        detail: "Active client with no task types configured.",
      })),
      ...noExec.map((c) => ({
        entity: "clients", id: c.id, label: `${c.name} (${c.code})`,
        detail: "Has active visits but no assigned executive.",
      })),
    ].slice(0, LIMIT),
  });

  const totals = { critical: 0, warning: 0, info: 0, issues: 0 };
  for (const c of checks) {
    if (c.count > 0) {
      totals[c.severity] += c.count;
      totals.issues += c.count;
    }
  }

  return { checks, totals, generatedAt: new Date().toISOString() };
}
