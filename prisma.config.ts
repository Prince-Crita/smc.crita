// prisma.config.ts — Prisma v7 configuration
// @ts-nocheck
import { defineConfig } from "prisma/config";
import * as dotenv from "dotenv";

/**
 * Which database the Prisma CLI talks to.
 *
 * This file used to load `.env.local` only. `.env.local` held the production
 * connection string, so every Prisma CLI command — `prisma db push`,
 * `prisma migrate`, `prisma studio`, `prisma db seed` — defaulted to the LIVE
 * company database, with nothing on screen to say so. Those are exactly the
 * commands that rewrite a schema or drop data.
 *
 * The order below makes local development the default instead:
 *
 *   1. DATABASE_URL already set in the shell   — an explicit, deliberate choice
 *   2. .env.development.local                  — the local PostgreSQL server
 *   3. .env.local                              — remaining shared config
 *
 * dotenv never overwrites a variable that is already set, so the first source
 * to provide DATABASE_URL wins.
 *
 * To run a Prisma command against a non-local database you now have to say so
 * out loud, e.g.
 *
 *   DATABASE_URL="postgresql://…" npx prisma migrate deploy
 *
 * The resolved target is printed below (host and database only, never the
 * password) so it is impossible to run one of these commands without seeing
 * where it is pointed.
 */
dotenv.config({ path: ".env.development.local" });
dotenv.config({ path: ".env.local" });

function describeTarget(url) {
  try {
    const u = new URL(url);
    const local = ["localhost", "127.0.0.1", "::1"].includes(u.hostname);
    return { text: `host=${u.hostname} db=${u.pathname.replace(/^\//, "").split("?")[0]}`, local };
  } catch {
    return { text: "<unset or unparseable>", local: false };
  }
}

const target = describeTarget(process.env.DATABASE_URL);
console.log(`[prisma] target: ${target.text}${target.local ? "" : "   ⚠ NOT a local database"}`);

export default defineConfig({
  earlyAccess: true,
  schema: "./prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL,
  },
  migrations: {
    // Seeding follows the same precedence — local development by default.
    seed: "tsx --env-file=.env.development.local prisma/seed.ts",
  },
});
