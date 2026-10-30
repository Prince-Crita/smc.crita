-- ============================================================================
-- PRODUCTION MIGRATION - geotagged visit photos.
--
-- Adds ONE new table, "visit_photos": the photo(s) an executive uploads when
-- starting a visit. The images themselves are stored in S3; this table holds
-- only each image's S3 key and a few facts about it (never image bytes).
--
-- -- SAFETY -------------------------------------------------------------------
-- ADDITIVE ONLY. No existing table, column, row or constraint is altered,
-- dropped, read or rewritten. The new table is created EMPTY: visits opened
-- before this release simply have no photos, which the application shows as
-- "no images" - nothing is backfilled or required retroactively.
--
--   1 new table      visit_photos           (created empty)
--   2 new indexes    s3Key (unique), visitId
--   2 foreign keys   visitId -> visits(id)  ON DELETE CASCADE
--                    uploadedById -> users(id) ON DELETE RESTRICT
--
-- The cascade means deleting a visit (Admin -> Calendar -> Delete) also
-- removes its photo rows, exactly like its tasks and team rows today.
--
-- The definitions match what Prisma generates for the VisitPhoto model, so
-- `prisma migrate diff` reports no difference afterwards.
--
-- -- ATOMIC -------------------------------------------------------------------
-- Runs inside one transaction: either everything is created or nothing is.
--
-- -- IDEMPOTENT ---------------------------------------------------------------
-- Safe to re-run: every object is created only if it does not exist yet.
--
-- -- HOW TO APPLY -------------------------------------------------------------
--   psql "$PRODUCTION_DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-10-31-visit-photos.sql
-- or paste everything between BEGIN and COMMIT into the Neon SQL Editor.
--
-- Take a Neon branch/backup first.
--
-- -- ORDERING (IMPORTANT) -----------------------------------------------------
-- Apply this BEFORE the new code is deployed (the new code reads and writes
-- visit_photos when a visit is opened or viewed). Old code ignores the new
-- table entirely, so this can be applied while the current version runs.
-- Requires 2026-10-30-visit-subtask-selection.sql to be applied as well.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS "visit_photos" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "originalName" TEXT,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "gpsLatitude" DOUBLE PRECISION,
    "gpsLongitude" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_photos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "visit_photos_s3Key_key" ON "visit_photos"("s3Key");

CREATE INDEX IF NOT EXISTS "visit_photos_visitId_idx" ON "visit_photos"("visitId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visit_photos_visitId_fkey') THEN
    ALTER TABLE "visit_photos" ADD CONSTRAINT "visit_photos_visitId_fkey"
      FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visit_photos_uploadedById_fkey') THEN
    ALTER TABLE "visit_photos" ADD CONSTRAINT "visit_photos_uploadedById_fkey"
      FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;

-- -- VERIFY (read-only) -------------------------------------------------------
-- Expect 0 rows in the new table, and the visits count unchanged:
--   SELECT count(*) FROM "visit_photos";
--   SELECT count(*) FROM "visits";
