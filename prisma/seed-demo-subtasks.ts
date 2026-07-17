/**
 * Demo polish: seed professional GLOBAL subtask templates for the 6 default
 * main tasks (none existed - visits looked empty), then backfill the active
 * visits' tasks from the resolved templates (client-specific > global),
 * preserving every existing subtask. Finally, mark realistic progress on the
 * OPEN (in-progress) visits.
 *
 * Run: npx tsx --env-file=.env.local prisma/seed-demo-subtasks.ts
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const GLOBAL_TEMPLATES: Record<string, string[]> = {
  OPERATIONAL_VERIFICATION: [
    "Verify daily production entries against floor records",
    "Check machine utilisation and downtime log",
    "Review workforce attendance register",
    "Inspect housekeeping and safety compliance",
  ],
  STOCK_VERIFICATION: [
    "Physical count of raw material stock",
    "Verify finished goods stock against system records",
    "Check stock ledger entries and GRNs",
    "Report stock discrepancies with reasons",
  ],
  AVF_REPORT: [
    "Collect audit verification format (AVF) data",
    "Validate AVF entries with supporting documents",
    "Submit AVF report for the visit",
  ],
  ACCOUNTS_VERIFICATION: [
    "Verify purchase and sales invoices",
    "Check petty cash book and vouchers",
    "Reconcile bank statement entries",
    "Review pending receivables and payables",
  ],
  MR_MONTHLY_REPORT: [
    "Compile monthly MR data from departments",
    "Verify MR figures with department heads",
    "Submit MR monthly report",
  ],
  MD_MEETING: [
    "Prepare visit summary points for MD",
    "Discuss findings and pending issues with MD",
    "Record MD instructions and action items",
  ],
};

async function main() {
  // ── 1. Seed global templates (skip task types that already have global) ──
  const existingGlobal = await prisma.subtaskTemplate.findMany({
    where: { clientId: null },
    select: { taskType: true },
  });
  const haveGlobal = new Set(existingGlobal.map((t) => t.taskType));
  let created = 0;
  for (const [taskType, titles] of Object.entries(GLOBAL_TEMPLATES)) {
    if (haveGlobal.has(taskType)) continue;
    await prisma.subtaskTemplate.createMany({
      data: titles.map((title, i) => ({ taskType, title, orderIndex: i, isActive: true, clientId: null })),
    });
    created += titles.length;
  }
  console.log(`created ${created} global subtask templates`);

  // ── 2. Backfill active visits' tasks from resolved templates ─────────────
  const visits = await prisma.visit.findMany({
    where: { status: { in: ["OPEN", "PENDING"] } },
    select: {
      id: true, clientId: true, status: true, visitNumber: true,
      tasks: { select: { id: true, taskType: true, subtasks: { select: { title: true } } } },
    },
  });

  const [clientTemplates, globalTemplates] = await Promise.all([
    prisma.subtaskTemplate.findMany({ where: { clientId: { not: null }, isActive: true }, orderBy: { orderIndex: "asc" } }),
    prisma.subtaskTemplate.findMany({ where: { clientId: null, isActive: true }, orderBy: { orderIndex: "asc" } }),
  ]);

  let added = 0;
  for (const v of visits) {
    for (const t of v.tasks) {
      const clientSpecific = clientTemplates.filter((tpl) => tpl.clientId === v.clientId && tpl.taskType === t.taskType);
      const wanted = (clientSpecific.length > 0 ? clientSpecific : globalTemplates.filter((tpl) => tpl.taskType === t.taskType))
        .map((tpl) => tpl.title);
      const have = new Set(t.subtasks.map((s) => s.title.replace("[CARRY-FORWARD] ", "")));
      const missing = wanted.filter((title) => !have.has(title));
      if (missing.length > 0) {
        await prisma.subtask.createMany({
          data: missing.map((title) => ({ taskId: t.id, title, isCompleted: false, isCarriedForward: false })),
        });
        added += missing.length;
      }
    }
  }
  console.log(`backfilled ${added} subtasks across ${visits.length} active visits`);

  // ── 3. Realistic progress on OPEN visits (~half of fresh subtasks done) ──
  const now = new Date();
  const openVisits = await prisma.visit.findMany({
    where: { status: "OPEN" },
    select: { id: true, tasks: { select: { id: true, subtasks: { select: { id: true, isCarriedForward: true, isCompleted: true }, orderBy: { createdAt: "asc" } } }, orderBy: { orderIndex: "asc" } } },
  });
  let completed = 0;
  for (const v of openVisits) {
    for (let ti = 0; ti < v.tasks.length; ti++) {
      const t = v.tasks[ti];
      const fresh = t.subtasks.filter((s) => !s.isCarriedForward && !s.isCompleted);
      // Earlier tasks more complete than later ones - looks like a real
      // in-progress day (first tasks done, later ones untouched).
      const ratio = ti < 2 ? 1 : ti < 4 ? 0.5 : 0;
      const n = Math.floor(fresh.length * ratio);
      const ids = fresh.slice(0, n).map((s) => s.id);
      if (ids.length > 0) {
        await prisma.subtask.updateMany({ where: { id: { in: ids } }, data: { isCompleted: true, completedAt: now } });
        completed += ids.length;
      }
      const doneAll = n === fresh.length && fresh.length > 0;
      await prisma.task.update({
        where: { id: t.id },
        data: { status: doneAll ? "COMPLETED" : n > 0 ? "IN_PROGRESS" : "PENDING", completedAt: doneAll ? now : null },
      });
    }
  }
  console.log(`marked ${completed} subtasks complete on ${openVisits.length} OPEN visits`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => pool.end());
