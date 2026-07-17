import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
async function main() {
  const clients = await prisma.client.findMany({ where: { isArchived: false }, select: { id: true, name: true } });
  for (const c of clients) {
    const v = await prisma.visit.findFirst({
      where: { clientId: c.id, status: { in: ["PENDING", "OPEN"] } },
      orderBy: { scheduledDate: "desc" },
      select: {
        visitNumber: true,
        tasks: {
          orderBy: { orderIndex: "asc" },
          select: { title: true, subtasks: { where: { isCarriedForward: true }, orderBy: { createdAt: "asc" }, select: { title: true, isCompleted: true } } },
        },
      },
    });
    const groups = (v?.tasks ?? []).filter((t) => t.subtasks.length > 0);
    if (groups.length > 0) {
      console.log(`${c.name} (${v!.visitNumber}):`);
      for (const g of groups) for (const s of g.subtasks) console.log(`  [${g.title}] ${s.title.replace("[CARRY-FORWARD] ", "")} ${s.isCompleted ? "(resolved)" : "(pending)"}`);
    }
  }
}
main().finally(() => pool.end());
