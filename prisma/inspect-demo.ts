/* Read-only inspection of demo data before the reset. */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const [total, byStatus, carried, carriedPending, clients, cfVisits] = await Promise.all([
    prisma.visit.count(),
    prisma.visit.groupBy({ by: ["status"], _count: { id: true } }),
    prisma.subtask.count({ where: { isCarriedForward: true } }),
    prisma.subtask.count({ where: { isCarriedForward: true, isCompleted: false } }),
    prisma.client.count({ where: { isArchived: false } }),
    prisma.visit.count({ where: { notes: { contains: "[CARRY-FORWARD:" } } }),
  ]);
  console.log("total visits:", total);
  console.log("by status:", JSON.stringify(byStatus));
  console.log("carried subtasks:", carried, "| pending carried:", carriedPending);
  console.log("active clients:", clients);
  console.log("CF-marked visits:", cfVisits);

  const nonClosed = await prisma.visit.findMany({
    where: { status: { not: "CLOSED" } },
    select: { id: true, clientId: true, status: true, scheduledDate: true, visitNumber: true, notes: true },
    orderBy: [{ clientId: "asc" }, { scheduledDate: "desc" }],
  });
  const perClient = new Map<string, number>();
  for (const v of nonClosed) perClient.set(v.clientId, (perClient.get(v.clientId) ?? 0) + 1);
  console.log("non-closed visits:", nonClosed.length, "| clients with >1 active:", [...perClient.values()].filter((n) => n > 1).length);
  const dates = nonClosed.map((v) => v.scheduledDate.toISOString().slice(0, 10));
  console.log("active date range:", dates.length ? `${dates.sort()[0]} .. ${dates[dates.length - 1]}` : "n/a");
}

main().finally(() => pool.end());
