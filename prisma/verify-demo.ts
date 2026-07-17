/* Read-only verification after the demo reset. */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const visits = await prisma.visit.findMany({
    where: { status: { in: ["OPEN", "PENDING"] } },
    orderBy: { scheduledDate: "asc" },
    select: {
      visitNumber: true, status: true, scheduledDate: true, endDate: true,
      client: { select: { name: true } },
      executive: { select: { name: true } },
      tasks: { select: { title: true, subtasks: { select: { isCompleted: true, isCarriedForward: true } } } },
    },
  });
  for (const v of visits) {
    const all = v.tasks.flatMap((t) => t.subtasks);
    const done = all.filter((s) => s.isCompleted).length;
    const cf = all.filter((s) => s.isCarriedForward && !s.isCompleted).length;
    console.log(
      `${v.visitNumber} | ${v.client.name} | ${v.status} | ${v.scheduledDate.toISOString().slice(0, 10)} -> ${v.endDate?.toISOString().slice(0, 10)} | tasks:${v.tasks.length} subtasks:${all.length} done:${done} cf:${cf} | ${v.executive.name}`
    );
    if (v.tasks.length === 0) console.log("  !! NO TASKS");
  }
}

main().finally(() => pool.end());
