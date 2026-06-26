// prisma.config.ts — Prisma v7 configuration
// @ts-nocheck
import { defineConfig } from "prisma/config";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

export default defineConfig({
  earlyAccess: true,
  schema: "./prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL,
  },
  migrations: {
    seed: "tsx --env-file=.env.local prisma/seed.ts",
  },
});
