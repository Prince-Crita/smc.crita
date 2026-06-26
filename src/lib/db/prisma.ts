/* eslint-disable @typescript-eslint/no-explicit-any */

// Explicitly load .env.local before anything else
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

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
      "DATABASE_URL environment variable is not set. Check your .env.local file."
    );
  }

  // Use standard pg driver — works perfectly in Node.js (local dev + production server)
  // Pool size capped at 10 to stay within Neon's serverless connection limits.
  // idleTimeoutMillis: release idle connections quickly; connectionTimeoutMillis: fail
  // fast instead of blocking the request queue on connection exhaustion.
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });

  const adapter = new PrismaPg(pool as any);
  return new PrismaClient({ adapter } as any);
}

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? (globalForPrisma.prisma = createPrismaClient());

export default prisma;
