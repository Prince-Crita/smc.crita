/**
 * Demo data reset — 16-07-2026 client presentation.
 *
 * Data-only (no schema changes). Rules:
 *   • CLOSED visits are never touched.
 *   • Each client keeps exactly ONE active (PENDING/OPEN) visit — surplus
 *     active visits (old auto-created carry-forward clutter) are deleted.
 *   • Kept visits get realistic Start/End dates in the current window
 *     (16–23 Jul 2026, 10:00 IST start, end = start + 2 days 18:00 IST).
 *   • A professional status mix: the earliest visits are OPEN (in progress,
 *     ~half their subtasks completed), later ones PENDING.
 *   • Pending carry-forward is trimmed to at most 2 genuine items per visit.
 *   • Old "Missed Weekly Visit" note markers are stripped from kept visits;
 *     a RESCHEDULED-FROM marker for last week is added per client so the
 *     missed-weekly generator does not recreate the clutter.
 *
 * Run: npx tsx --env-file=.env.local prisma/reset-demo-data.ts
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
/** A Date at the given IST wall-clock time on an IST calendar day. */
function istDate(y: number, m: number, d: number, hh: number, mm = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - IST_OFFSET_MS);
}

// Visit start slots: business days from today (Thu 16-07-2026) onward.
const START_SLOTS: Array<[number, number]> = [
  [7, 16], [7, 17], [7, 18], [7, 20], [7, 21], [7, 22], [7, 23], [7, 24],
];

async function main() {
  const now = new Date();

  // ── 1. Collect active visits, newest first per client ────────────────────
  const active = await prisma.visit.findMany({
    where: { status: { in: ["PENDING", "OPEN"] } },
    orderBy: { scheduledDate: "desc" },
    select: { id: true, clientId: true, status: true, visitNumber: true, notes: true },
  });

  const keptByClient = new Map<string, (typeof active)[number]>();
  const toDelete: string[] = [];
  for (const v of active) {
    if (keptByClient.has(v.clientId)) toDelete.push(v.id);
    else keptByClient.set(v.clientId, v);
  }

  // ── 2. Delete surplus active visits (dependents first) ───────────────────
  if (toDelete.length > 0) {
    await prisma.activityLog.deleteMany({ where: { visitId: { in: toDelete } } });
    await prisma.visitDelegation.deleteMany({ where: { visitId: { in: toDelete } } });
    await prisma.visitReassignment.deleteMany({ where: { visitId: { in: toDelete } } });
    await prisma.visit.deleteMany({ where: { id: { in: toDelete } } }); // tasks/subtasks cascade
  }
  console.log(`deleted ${toDelete.length} surplus active visits`);

  // ── 3. Re-date + re-status the kept visits ────────────────────────────────
  const kept = [...keptByClient.values()];
  let openCount = 0;
  for (let i = 0; i < kept.length; i++) {
    const v = kept[i];
    const [m, d] = START_SLOTS[i % START_SLOTS.length];
    const start = istDate(2026, m, d, 10, 0);
    const end = new Date(istDate(2026, m, d, 18, 0).getTime() + 2 * 24 * 60 * 60 * 1000);

    // First 3 visits (today/tomorrow) are In Progress; the rest are Pending.
    const makeOpen = i < 3;
    if (makeOpen) openCount++;

    // Clean notes: drop old carry-forward / reschedule marker lines, then add
    // a RESCHEDULED-FROM marker for last week (Mon 06-07-2026) so the
    // missed-weekly generator treats last week as handled for this client.
    const cleanedNotes = (v.notes ?? "")
      .split("\n")
      .filter((line) => !line.includes("[CARRY-FORWARD:") && !line.includes("[RESCHEDULED-FROM:") && !line.includes("[Rescheduled:"))
      .join("\n")
      .trim();
    const marker = `[RESCHEDULED-FROM: ${istDate(2026, 7, 8, 10, 0).toISOString()}]`;
    const notes = cleanedNotes ? `${cleanedNotes}\n${marker}` : marker;

    await prisma.visit.update({
      where: { id: v.id },
      data: {
        scheduledDate: start,
        endDate: end,
        status: makeOpen ? "OPEN" : "PENDING",
        openedAt: makeOpen ? istDate(2026, m, d, 9, 45) : null,
        notes,
      },
    });
  }
  console.log(`re-dated ${kept.length} kept visits (${openCount} OPEN, ${kept.length - openCount} PENDING)`);

  // ── 4. Trim pending carry-forward to ≤2 genuine items per kept visit ─────
  const keptIds = kept.map((v) => v.id);
  const carried = await prisma.subtask.findMany({
    where: { isCompleted: false, isCarriedForward: true, task: { visitId: { in: keptIds } } },
    select: { id: true, task: { select: { visitId: true } } },
    orderBy: { createdAt: "asc" },
  });
  const seen = new Map<string, number>();
  const surplus: string[] = [];
  for (const s of carried) {
    const n = (seen.get(s.task.visitId) ?? 0) + 1;
    seen.set(s.task.visitId, n);
    if (n > 2) surplus.push(s.id);
  }
  if (surplus.length > 0) {
    await prisma.subtask.deleteMany({ where: { id: { in: surplus } } });
  }
  console.log(`trimmed ${surplus.length} surplus pending carry-forward subtasks`);

  // ── 5. In-progress realism: complete ~half the subtasks of OPEN visits ───
  const openVisits = await prisma.visit.findMany({
    where: { id: { in: keptIds }, status: "OPEN" },
    select: { id: true, tasks: { select: { id: true, subtasks: { select: { id: true, isCarriedForward: true }, orderBy: { createdAt: "asc" } } } } },
  });
  let completed = 0;
  for (const v of openVisits) {
    for (const t of v.tasks) {
      const fresh = t.subtasks.filter((s) => !s.isCarriedForward);
      const toComplete = fresh.slice(0, Math.ceil(fresh.length / 2)).map((s) => s.id);
      if (toComplete.length > 0) {
        await prisma.subtask.updateMany({
          where: { id: { in: toComplete } },
          data: { isCompleted: true, completedAt: now, incompletionReason: null },
        });
        completed += toComplete.length;
      }
    }
    // Reflect progress on task status
    await prisma.task.updateMany({ where: { visitId: v.id }, data: { status: "IN_PROGRESS" } });
  }
  console.log(`marked ${completed} subtasks complete across ${openVisits.length} OPEN visits`);

  // Ensure PENDING kept visits are fully fresh (no stray completions)
  await prisma.subtask.updateMany({
    where: { task: { visit: { id: { in: keptIds }, status: "PENDING" } }, isCompleted: true },
    data: { isCompleted: false, completedAt: null },
  });
  await prisma.task.updateMany({
    where: { visit: { id: { in: keptIds }, status: "PENDING" } },
    data: { status: "PENDING", completedAt: null },
  });

  // ── 6. Summary ────────────────────────────────────────────────────────────
  const [byStatus, pendingCarried] = await Promise.all([
    prisma.visit.groupBy({ by: ["status"], _count: { id: true } }),
    prisma.subtask.count({ where: { isCarriedForward: true, isCompleted: false } }),
  ]);
  console.log("final visit mix:", JSON.stringify(byStatus));
  console.log("final pending carry-forward subtasks:", pendingCarried);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => pool.end());
