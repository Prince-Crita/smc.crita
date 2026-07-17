import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
async function main() {
  // Remove duplicate carried subtasks sharing (taskId, sourceSubtaskId) -
  // artifacts of a race between concurrent carry-forward sweeps. Keep the
  // earliest row; never touch completed rows (keep completed over pending).
  const carried = await prisma.subtask.findMany({
    where: { isCarriedForward: true, sourceSubtaskId: { not: null } },
    orderBy: [{ isCompleted: "desc" }, { createdAt: "asc" }],
    select: { id: true, taskId: true, sourceSubtaskId: true },
  });
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const s of carried) {
    const key = `${s.taskId}|${s.sourceSubtaskId}`;
    if (seen.has(key)) dupes.push(s.id);
    else seen.add(key);
  }
  if (dupes.length) await prisma.subtask.deleteMany({ where: { id: { in: dupes } } });
  console.log(`removed ${dupes.length} duplicate carried subtasks`);
}
main().finally(() => pool.end());
