-- Performance indexes (2026-08-20)
--
-- These match the `@@index(...)` declarations added to prisma/schema.prisma.
-- PostgreSQL does not index foreign keys automatically, so every one of the
-- lookups below was a sequential scan of the whole table.
--
-- Index creation only. No table, column, type, constraint or data is changed,
-- so this is safe to run against a live database and changes no behaviour —
-- only how quickly the same queries are answered.
--
-- CONCURRENTLY means the tables stay readable and writable while each index
-- builds. It cannot run inside a transaction block, so run this file
-- statement-by-statement (psql runs it fine as-is; do not wrap it in BEGIN).
--
-- Apply with e.g.:
--   psql "$DATABASE_URL" -f prisma/sql/performance-indexes.sql
-- or let `prisma db push` create them from schema.prisma (that form takes a
-- brief lock per table instead of building concurrently).

-- visits: client/executive drill-downs, calendar week windows, list ordering,
-- and the carry-forward due sweep's status filter.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "visits_clientId_idx"      ON "visits" ("clientId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "visits_executiveId_idx"   ON "visits" ("executiveId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "visits_scheduledDate_idx" ON "visits" ("scheduledDate");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "visits_status_idx"        ON "visits" ("status");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "visits_updatedAt_idx"     ON "visits" ("updatedAt");

-- subtasks: the largest table. Carry-forward screens scan it by flag, and
-- deleting a visit must find the carried copies pointing back into it.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "subtasks_isCarriedForward_idx"        ON "subtasks" ("isCarriedForward");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "subtasks_carryForwardRequestedAt_idx" ON "subtasks" ("carryForwardRequestedAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "subtasks_sourceSubtaskId_idx"         ON "subtasks" ("sourceSubtaskId");

-- subtask_templates: read per client whenever a visit is scaffolded.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "subtask_templates_clientId_taskType_idx" ON "subtask_templates" ("clientId", "taskType");

-- activity_logs: fastest-growing table, previously with no index at all.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "activity_logs_visitId_idx"           ON "activity_logs" ("visitId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "activity_logs_userId_createdAt_idx"  ON "activity_logs" ("userId", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "activity_logs_action_createdAt_idx"  ON "activity_logs" ("action", "createdAt");

-- visit history tables: looked up by visit, and by "who is this waiting on".
CREATE INDEX CONCURRENTLY IF NOT EXISTS "visit_reassignments_visitId_idx"            ON "visit_reassignments" ("visitId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "visit_delegations_visitId_idx"              ON "visit_delegations" ("visitId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "visit_delegations_toExecutiveId_status_idx" ON "visit_delegations" ("toExecutiveId", "status");

ANALYZE;
