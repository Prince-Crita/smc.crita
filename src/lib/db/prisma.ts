/**
 * Prisma Client Singleton
 *
 * Uses PrismaPg (standard pg.Pool driver adapter) for PostgreSQL.
 * This adapter is compatible with Neon PostgreSQL and Vercel's serverless
 * Node.js runtime.
 *
 * Key decisions:
 * - NO dotenv loading: Next.js / Vercel inject env vars natively. dotenv here
 *   is redundant and can cause issues in serverless cold-starts.
 * - Singleton via globalThis: Prevents "too many Prisma clients" in
 *   Next.js hot-module-replacement (dev) and Vercel function reuse.
 * - PrismaPg adapter requires previewFeatures = ["driverAdapters"] in schema.
 * - Pool capped at 5 for Vercel's concurrent function limit.
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL environment variable is not set. " +
        "Set it in your .env.local (local) or Vercel project settings (production)."
    );
  }

  // pg.Pool with Neon PostgreSQL over SSL.
  // max: 5 — conservative limit suitable for Vercel's serverless concurrency model.
  //   Each Vercel function invocation gets its own cold-start; a large pool here
  //   would exhaust Neon's connection limit when many functions run simultaneously.
  // ssl.rejectUnauthorized: false — required for Neon's self-signed certificates.
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adapter = new PrismaPg(pool as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new PrismaClient({ adapter } as any);
}

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? (globalForPrisma.prisma = createPrismaClient());

export default prisma;
