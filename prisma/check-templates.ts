import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
async function main() {
  const rows = await prisma.subtaskTemplate.groupBy({ by: ["taskType", "clientId"], where: { isActive: true }, _count: { id: true } });
  for (const r of rows) console.log(`${r.taskType} | ${r.clientId ?? "GLOBAL"} | ${r._count.id}`);
}
main().finally(() => pool.end());
