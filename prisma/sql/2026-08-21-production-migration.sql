-- ============================================================================
-- PRODUCTION MIGRATION — brings the live database up to the schema required by
-- the Team Visit / Super Admin / admin-approved Carry Forward release.
--
-- Generated from the live schema with:
--   npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
-- then reviewed statement by statement.
--
-- ── SAFETY ─────────────────────────────────────────────────────────────────
-- Every statement is ADDITIVE. There is no DROP, TRUNCATE, DELETE, UPDATE,
-- INSERT, ALTER COLUMN, RENAME, or SET NOT NULL on an existing column.
-- Nothing reads, moves, transforms or removes existing rows.
--
--   2  new enum types      "VisitType", "VisitRole"          (did not exist)
--   2  new columns on subtasks + 2 more   all NULLABLE, no backfill
--   1  new column on visits  NOT NULL DEFAULT 'SOLO'
--   2  new tables          created EMPTY
--  17  new indexes         performance only, no semantic effect
--   5  new foreign keys    all on new columns/tables
--
-- About `visits.visitType NOT NULL DEFAULT 'SOLO'`:
--   PostgreSQL 11+ records the default in the catalog instead of rewriting the
--   table, so this does not touch existing rows on disk. Every pre-existing
--   visit reads back as SOLO, which is exactly correct — they were all
--   single-executive visits, and SOLO is the behaviour they already had.
--
-- ── ATOMIC ─────────────────────────────────────────────────────────────────
-- DDL is transactional in PostgreSQL, so the whole file runs inside one
-- transaction: either the database ends up fully migrated, or completely
-- unchanged. There is no half-migrated state.
--
-- ── IDEMPOTENT ─────────────────────────────────────────────────────────────
-- Safe to re-run. Every object is created only if absent, so an interrupted
-- run can simply be repeated.
--
-- ── HOW TO APPLY ───────────────────────────────────────────────────────────
--   psql "$PRODUCTION_DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-08-21-production-migration.sql
--
-- Take a Neon branch/backup first. Neon's point-in-time restore covers this,
-- but an explicit branch before a schema change costs nothing.
--
-- ── ORDERING (IMPORTANT) ───────────────────────────────────────────────────
-- Apply this BEFORE the new code is deployed. The new code selects
-- visits.visitType on nearly every read; against an unmigrated database it
-- fails with Prisma P2022 immediately, for every user.
-- Old code against the migrated database is unaffected: it simply ignores the
-- new columns and tables, so this migration can be applied safely while the
-- current version is still running.
-- ============================================================================

BEGIN;

-- ─── Enum types ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'VisitType' AND n.nspname = 'public') THEN
    CREATE TYPE "VisitType" AS ENUM ('SOLO', 'TEAM');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'VisitRole' AND n.nspname = 'public') THEN
    CREATE TYPE "VisitRole" AS ENUM ('LEAD', 'MEMBER');
  END IF;
END $$;

-- ─── New columns (carry-forward approval workflow) ──────────────────────────
-- All nullable. Existing subtasks keep NULL, which the application reads as
-- "no carry-forward decision has been made", exactly as intended.
ALTER TABLE "subtasks" ADD COLUMN IF NOT EXISTS "carryForwardRequestedAt"  TIMESTAMP(3);
ALTER TABLE "subtasks" ADD COLUMN IF NOT EXISTS "carryForwardApprovedAt"   TIMESTAMP(3);
ALTER TABLE "subtasks" ADD COLUMN IF NOT EXISTS "carryForwardApprovedById" TEXT;
ALTER TABLE "subtasks" ADD COLUMN IF NOT EXISTS "carryForwardRejectedAt"   TIMESTAMP(3);

-- ─── New column (solo/team visits) ──────────────────────────────────────────
-- Existing visits become SOLO, which is what they already were.
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "visitType" "VisitType" NOT NULL DEFAULT 'SOLO';

-- ─── New tables (created empty) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "admin_operations" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "action"       TEXT NOT NULL,
    "entityType"   TEXT NOT NULL,
    "entityId"     TEXT NOT NULL,
    "summary"      TEXT NOT NULL,
    "reason"       TEXT,
    "beforeJson"   JSONB,
    "afterJson"    JSONB,
    "isReversible" BOOLEAN NOT NULL DEFAULT false,
    "undoneAt"     TIMESTAMP(3),
    "undoneById"   TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_operations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "visit_assignments" (
    "id"          TEXT NOT NULL,
    "visitId"     TEXT NOT NULL,
    "executiveId" TEXT NOT NULL,
    "role"        "VisitRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "visit_assignments_pkey" PRIMARY KEY ("id")
);

-- ─── Indexes ────────────────────────────────────────────────────────────────
-- Performance only. PostgreSQL does not index foreign keys automatically, so
-- these lookups were sequential scans. No semantic effect on any query result.
CREATE INDEX        IF NOT EXISTS "admin_operations_createdAt_idx"            ON "admin_operations"("createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "visit_assignments_visitId_executiveId_key" ON "visit_assignments"("visitId", "executiveId");
CREATE INDEX        IF NOT EXISTS "activity_logs_visitId_idx"                 ON "activity_logs"("visitId");
CREATE INDEX        IF NOT EXISTS "activity_logs_userId_createdAt_idx"        ON "activity_logs"("userId", "createdAt");
CREATE INDEX        IF NOT EXISTS "activity_logs_action_createdAt_idx"        ON "activity_logs"("action", "createdAt");
CREATE INDEX        IF NOT EXISTS "subtask_templates_clientId_taskType_idx"   ON "subtask_templates"("clientId", "taskType");
CREATE INDEX        IF NOT EXISTS "subtasks_isCarriedForward_idx"             ON "subtasks"("isCarriedForward");
CREATE INDEX        IF NOT EXISTS "subtasks_carryForwardRequestedAt_idx"      ON "subtasks"("carryForwardRequestedAt");
CREATE INDEX        IF NOT EXISTS "subtasks_sourceSubtaskId_idx"              ON "subtasks"("sourceSubtaskId");
CREATE INDEX        IF NOT EXISTS "visit_delegations_visitId_idx"             ON "visit_delegations"("visitId");
CREATE INDEX        IF NOT EXISTS "visit_delegations_toExecutiveId_status_idx" ON "visit_delegations"("toExecutiveId", "status");
CREATE INDEX        IF NOT EXISTS "visit_reassignments_visitId_idx"           ON "visit_reassignments"("visitId");
CREATE INDEX        IF NOT EXISTS "visits_clientId_idx"                       ON "visits"("clientId");
CREATE INDEX        IF NOT EXISTS "visits_executiveId_idx"                    ON "visits"("executiveId");
CREATE INDEX        IF NOT EXISTS "visits_scheduledDate_idx"                  ON "visits"("scheduledDate");
CREATE INDEX        IF NOT EXISTS "visits_status_idx"                         ON "visits"("status");
CREATE INDEX        IF NOT EXISTS "visits_updatedAt_idx"                      ON "visits"("updatedAt");

-- ─── Foreign keys ───────────────────────────────────────────────────────────
-- All reference brand-new columns or brand-new (empty) tables, so validation
-- has nothing existing to reject.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_operations_userId_fkey') THEN
    ALTER TABLE "admin_operations" ADD CONSTRAINT "admin_operations_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_operations_undoneById_fkey') THEN
    ALTER TABLE "admin_operations" ADD CONSTRAINT "admin_operations_undoneById_fkey"
      FOREIGN KEY ("undoneById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visit_assignments_visitId_fkey') THEN
    ALTER TABLE "visit_assignments" ADD CONSTRAINT "visit_assignments_visitId_fkey"
      FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visit_assignments_executiveId_fkey') THEN
    ALTER TABLE "visit_assignments" ADD CONSTRAINT "visit_assignments_executiveId_fkey"
      FOREIGN KEY ("executiveId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subtasks_carryForwardApprovedById_fkey') THEN
    ALTER TABLE "subtasks" ADD CONSTRAINT "subtasks_carryForwardApprovedById_fkey"
      FOREIGN KEY ("carryForwardApprovedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;

-- Refresh planner statistics for the new indexes. Read-only.
ANALYZE;
