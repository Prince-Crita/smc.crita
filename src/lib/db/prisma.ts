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
import {
  assertSafeDatabaseTarget,
  describeDatabaseTarget,
  formatDatabaseTarget,
} from "@/lib/db/database-target";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * True when the connection string points at a database on this machine.
 * Local PostgreSQL installs generally have SSL compiled out and answer the
 * TLS handshake with "server does not support SSL connections", so the
 * Neon-oriented ssl option has to be skipped for them.
 */
export function isLocalDatabase(connectionString: string): boolean {
  try {
    const { hostname } = new URL(connectionString);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL environment variable is not set. " +
        "Set it in .env.development.local (local development) or in the " +
        "deployment's environment (Vercel / company server)."
    );
  }

  // A development or test process may only talk to a local database. See
  // lib/db/database-target.ts for why this is a hard failure and how to
  // override it deliberately (ALLOW_REMOTE_DB=1).
  assertSafeDatabaseTarget(connectionString);

  // Say out loud which database this process is using. Host, port, database
  // and role only — never the password or the connection string.
  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[db] ${process.env.NODE_ENV ?? "unknown"} → ${formatDatabaseTarget(describeDatabaseTarget(connectionString))}`
    );
  }

  // pg.Pool with Neon PostgreSQL over SSL.
  // max: 5 — conservative limit suitable for Vercel's serverless concurrency model.
  //   Each Vercel function invocation gets its own cold-start; a large pool here
  //   would exhaust Neon's connection limit when many functions run simultaneously.
  // ssl.rejectUnauthorized: false — required for Neon's self-signed certificates.
  //   A local PostgreSQL server is typically built without SSL support and
  //   rejects the handshake outright, so SSL is skipped for local hosts only.
  //   Every remote host (Neon in dev and production) keeps the previous setting.
  const pool = new Pool({
    connectionString,
    ssl: isLocalDatabase(connectionString) ? false : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adapter = new PrismaPg(pool as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new PrismaClient({ adapter } as any);
}

/**
 * The client is created on FIRST USE, not when this module is imported.
 *
 * `next build` imports every route module to collect page data. With eager
 * creation, that import alone demanded a reachable DATABASE_URL — so a build
 * could only succeed if a connection string happened to be present, and it
 * would happily have been the production one. A build should not need a
 * database at all, and a missing DATABASE_URL should surface as a clear
 * runtime error on the first query rather than as a build failure.
 *
 * The Proxy is transparent: `prisma.visit.findMany(...)`, `prisma.$transaction(...)`
 * and every other call behave exactly as before, and the singleton is still
 * cached on globalThis so hot-module reloading does not pile up clients.
 */
function getPrismaClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }
  return globalForPrisma.prisma;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getPrismaClient() as unknown as Record<string | symbol, unknown>;
    const value = Reflect.get(client, prop, receiver);
    // Methods must stay bound to the real client ($transaction, $queryRaw, …).
    return typeof value === "function" ? value.bind(client) : value;
  },
  has(_target, prop) {
    return prop in (getPrismaClient() as unknown as object);
  },
  ownKeys() {
    return Reflect.ownKeys(getPrismaClient() as unknown as object);
  },
  getOwnPropertyDescriptor(_target, prop) {
    const d = Reflect.getOwnPropertyDescriptor(getPrismaClient() as unknown as object, prop);
    return d && { ...d, configurable: true };
  },
});

export default prisma;
