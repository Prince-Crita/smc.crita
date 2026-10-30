-- ============================================================================
-- PRODUCTION MIGRATION - half-day leave (Phase 2, requirement 5).
--
-- Lets a leave request be for the whole day or for one half of it.
--
-- -- SAFETY -------------------------------------------------------------------
-- ADDITIVE ONLY. There is no DROP, TRUNCATE, DELETE, UPDATE, INSERT, RENAME,
-- ALTER COLUMN or SET NOT NULL on an existing column. No existing row is read,
-- moved, transformed or removed.
--
--   2 new enum types         "LeaveType"     (FULL_DAY, HALF_DAY)
--                            "HalfDayPeriod" (FIRST_HALF, SECOND_HALF)
--   2 new columns on leave_requests
--     "leaveType"      NOT NULL DEFAULT 'FULL_DAY'
--     "halfDayPeriod"  nullable
--
-- PostgreSQL 11+ records a constant default in the catalog instead of
-- rewriting the table, so existing rows are not touched on disk. Every
-- pre-existing leave request reads back as FULL_DAY with no half-day period -
-- exactly what it always was. Statuses, dates, reasons and reviews are
-- unchanged.
--
-- The definitions match what Prisma generates for
--   leaveType     LeaveType      @default(FULL_DAY)
--   halfDayPeriod HalfDayPeriod?
-- so `prisma migrate diff` reports no difference afterwards.
--
-- -- ATOMIC -------------------------------------------------------------------
-- Runs inside one transaction: either everything is created or nothing is.
--
-- -- IDEMPOTENT ---------------------------------------------------------------
-- Safe to re-run: every object is created only if it does not exist yet.
--
-- -- HOW TO APPLY -------------------------------------------------------------
-- Through scripts/production-migration.mjs (applies every release file in
-- order), or on its own:
--   psql "$PRODUCTION_DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-10-30-leave-half-day.sql
--
-- Take a database backup first.
--
-- -- ORDERING (IMPORTANT) -----------------------------------------------------
-- Apply this BEFORE the new code is deployed. The new code reads
-- leave_requests."leaveType"; against an unmigrated database every leave read
-- fails with Prisma P2022 ("column does not exist").
-- Old code against the migrated database is unaffected - it ignores the new
-- columns, and rows it inserts receive the FULL_DAY default - so this can be
-- applied while the current version is still running.
-- ============================================================================

BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'LeaveType' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "LeaveType" AS ENUM ('FULL_DAY', 'HALF_DAY');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'HalfDayPeriod' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "HalfDayPeriod" AS ENUM ('FIRST_HALF', 'SECOND_HALF');
  END IF;
END $$;

ALTER TABLE "leave_requests"
  ADD COLUMN IF NOT EXISTS "leaveType" "LeaveType" NOT NULL DEFAULT 'FULL_DAY',
  ADD COLUMN IF NOT EXISTS "halfDayPeriod" "HalfDayPeriod";

COMMIT;

-- -- VERIFY (read-only) -------------------------------------------------------
-- Every existing request is a full-day request; the counts must match:
--   SELECT count(*) FROM "leave_requests";
--   SELECT count(*) FROM "leave_requests" WHERE "leaveType" = 'FULL_DAY' AND "halfDayPeriod" IS NULL;
