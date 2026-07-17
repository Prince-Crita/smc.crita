import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
async function main() {
  // One PENDING carried subtask per (taskId, title) - remove stacked
  // duplicates that came from carrying the same missed item off multiple
  // old visits. Keep the earliest row.
  const carried = await prisma.subtask.findMany({
    where: { isCarriedForward: true, isCompleted: false },
    orderBy: { createdAt: "asc" },
    select: { id: true, taskId: true, title: true },
  });
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const s of carried) {
    const key = `${s.taskId}|${s.title.replace("[CARRY-FORWARD] ", "")}`;
    if (seen.has(key)) dupes.push(s.id);
    else seen.add(key);
  }
  if (dupes.length) await prisma.subtask.deleteMany({ where: { id: { in: dupes } } });
  console.log(`removed ${dupes.length} title-duplicate pending carried subtasks`);
  console.log("remaining pending carried:", await prisma.subtask.count({ where: { isCarriedForward: true, isCompleted: false } }));
}
main().finally(() => pool.end());
