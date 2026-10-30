-- ============================================================================
-- PRODUCTION MIGRATION - per-visit SUBTASK selection (Phase 2 corrections).
--
-- Adds ONE column to "visits": "selectedSubtaskTemplateIds", the subtask
-- templates the admin ticked under the selected main tasks in
-- Admin -> Calendar -> Create Visit.
--
-- Requires 2026-10-24-visit-task-selection.sql to have been applied first
-- (it is already live if the Phase 2 release is deployed).
--
-- -- SAFETY -------------------------------------------------------------------
-- ADDITIVE ONLY. There is no DROP, TRUNCATE, DELETE, UPDATE, INSERT, RENAME,
-- ALTER COLUMN or SET NOT NULL on an existing column. No existing row is read,
-- moved, transformed or removed.
--
--   1 new column on visits   TEXT[] DEFAULT ARRAY[]::TEXT[]
--
-- PostgreSQL 11+ records the default in the catalog instead of rewriting the
-- table, so this does not touch existing rows on disk. Every pre-existing
-- visit reads back as an EMPTY list, which the application treats as "no
-- subtask-level selection - every included main task carries all of its
-- configured subtasks", i.e. exactly the behaviour those visits already have.
-- Nothing about an existing visit, task, subtask, completion or carry-forward
-- record changes.
--
-- The column definition matches what Prisma generates for
--   selectedSubtaskTemplateIds String[] @default([])
-- so `prisma migrate diff` reports no difference afterwards.
--
-- -- ATOMIC -------------------------------------------------------------------
-- Runs inside one transaction: the column is either added or nothing changes.
--
-- -- IDEMPOTENT ---------------------------------------------------------------
-- Safe to re-run (ADD COLUMN IF NOT EXISTS).
--
-- -- HOW TO APPLY -------------------------------------------------------------
--   psql "$PRODUCTION_DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-10-30-visit-subtask-selection.sql
-- or paste the statements between BEGIN and COMMIT into the Neon SQL Editor.
--
-- Take a Neon branch/backup first.
--
-- -- ORDERING (IMPORTANT) -----------------------------------------------------
-- Apply this BEFORE the new code is deployed. The new code reads
-- visits."selectedSubtaskTemplateIds"; against an unmigrated database every
-- visit read fails with Prisma P2022 ("column does not exist").
-- Old code against the migrated database is unaffected - it ignores the new
-- column, and rows it inserts receive the empty default - so this can be
-- applied while the current version is still running.
-- ============================================================================

BEGIN;

ALTER TABLE "visits"
  ADD COLUMN IF NOT EXISTS "selectedSubtaskTemplateIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

COMMIT;

-- -- VERIFY (read-only) -------------------------------------------------------
-- Expect one row: selectedSubtaskTemplateIds | ARRAY | YES | ARRAY[]::text[]
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'visits' AND column_name = 'selectedSubtaskTemplateIds';
--
-- Expect 0 (every existing visit reads back as an empty selection):
--   SELECT count(*) FROM "visits" WHERE cardinality("selectedSubtaskTemplateIds") > 0;
