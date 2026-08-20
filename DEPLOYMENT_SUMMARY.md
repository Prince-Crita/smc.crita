# Production deployment summary — Team Visit / Super Admin / Carry-Forward release

Prepared 2026-08-21. Source branch `fix/admin-client-delete-with-history` → `main`.

---

## 1. Deployment order (read this first)

The production database is **missing schema this code requires**. `visits.visitType`
is selected on nearly every read, so deploying the code first would fail with
Prisma `P2022` for every user, immediately.

Old code against the migrated database is unaffected — it simply ignores the new
columns and tables. So the migration is applied first, with the current version
still serving traffic, and there is no downtime window.

```
1. Back up / branch the Neon database
2. Apply prisma/sql/2026-08-21-production-migration.sql   ← MUST be first
3. Verify the migration (queries in §5)
4. Push to main  →  Vercel builds and deploys
5. Smoke-test production
```

Doing 4 before 2 takes the application down.

---

## 2. Scope of change

76 files, ~9,300 insertions against `origin/main`. Three commits already on the
branch, plus a large body of work committed as part of this deployment.

### Features added

| Area | Change |
|---|---|
| **Team Visits** | A visit is `SOLO` or `TEAM`. `Visit.executiveId` remains the owner/lead; members live in the new `visit_assignments` table. Existing visits are SOLO — the behaviour they already had. |
| **Super Admin** | System overview, record inspector, global search, system health, control panel, assignment correction, activity log with undo/redo backed by the new `admin_operations` table. Gated to `SUPER_ADMIN`; Admin and Executive receive 403. |
| **Carry Forward** | Now fully admin-approved. The application no longer creates carry-forward on its own: an incomplete subtask on a finished visit becomes a *pending request* (`carryForwardRequestedAt`), and nothing is copied anywhere until an admin approves it. |
| **Delete Visit** | Admin → Calendar → Delete removes one visit occurrence and only its own dependent rows, in a single transaction. Admin/Super-Admin only. |
| **Performance** | Per-visit subtask COUNT aggregates instead of loading every subtask row; list endpoints no longer serialise the task tree; only the on-screen layout is rendered; 17 database indexes. |
| **Company deployment** | Optional `NEXT_PUBLIC_BASE_PATH` mount point and a standalone server build, for the reverse-proxied company server. Off by default — Vercel and local development are unchanged. |
| **Environment safety** | The dev server refuses to start against a remote database; every non-production start prints its target; the Prisma CLI defaults to the local database; `/api/dev/db-target` reports the live connection (404 in production). |

---

## 3. Production schema differences

Verified against the live database by read-only catalog inspection.

| Required change | Exists in Neon? | Type | Safe? | Action |
|---|---|---|---|---|
| enum `VisitType` | No | New type | Yes — additive | CREATE TYPE |
| enum `VisitRole` | No | New type | Yes — additive | CREATE TYPE |
| `visits.visitType` | No | New column, `NOT NULL DEFAULT 'SOLO'` | Yes — catalog default, no table rewrite; existing rows read as SOLO | ADD COLUMN |
| `subtasks.carryForwardRequestedAt` | No | New column, nullable | Yes — additive | ADD COLUMN |
| `subtasks.carryForwardApprovedAt` | No | New column, nullable | Yes — additive | ADD COLUMN |
| `subtasks.carryForwardApprovedById` | No | New column, nullable + FK | Yes — additive | ADD COLUMN |
| `subtasks.carryForwardRejectedAt` | No | New column, nullable | Yes — additive | ADD COLUMN |
| table `visit_assignments` | No | New table | Yes — created empty | CREATE TABLE |
| table `admin_operations` | No | New table | Yes — created empty | CREATE TABLE |
| 17 indexes | No | Performance only | Yes — no semantic effect | CREATE INDEX |
| 5 foreign keys | No | On new columns/tables only | Yes — nothing existing to reject | ADD CONSTRAINT |
| `client_task_types`, `clients.reportEmails`, `visits.endDate`, `subtasks.isCarriedForward`, `ActivityAction` values, `Role.SUPER_ADMIN` | **Already present** | — | — | none |

**Nothing is dropped, renamed, retyped, truncated, deleted, updated or backfilled.**
All 28 statements were classified automatically; every one is additive.

### Production data at time of audit

11 users (2 Admin, 8 Executive, 1 Super Admin) · 51 clients · 133 visits
(52 pending / 6 open / 75 closed) · 437 tasks · 949 subtasks · 304 already
carried-forward · 2,437 activity logs · 80 attendance · 4 leave requests.

---

## 4. Behaviour against existing production records

| Existing data | Behaviour after deployment |
|---|---|
| 133 existing visits | Become `visitType = SOLO`, which is what they already were. No duplication, no recreation. |
| Existing tasks / subtasks | Untouched. New carry-forward columns are NULL, read as "no decision made". |
| 304 already-carried subtasks | Skipped by the new sweep (`isCarriedForward` is excluded). Unchanged. |
| 37 visits with the carry-forward note marker | Still recognised by the same marker. Unchanged. |
| Existing executives / assignments | `Visit.executiveId` remains the owner. No `visit_assignments` row is required for a solo visit. |
| Existing clients (incl. 1 archived) | Untouched; no new field is required of them. |
| Attendance / leave | Untouched. |
| Authentication | Unchanged — same JWT cookie, same roles. |

### One expected, visible change on day one

The first time an admin loads a page after deployment, the carry-forward sweep
marks incomplete subtasks on finished visits as **pending approval requests**.
At audit time that is **173 subtasks**.

This is the new admin-approved workflow behaving as designed. It writes one
nullable timestamp per subtask. It creates **no visits and no carried copies** —
nothing moves until an admin approves it, and the admin can reject in bulk.
Worth telling the client in advance so the queue is not a surprise.

---

## 5. Verifying the migration afterwards

```sql
-- expect: SOLO = the existing visit count, TEAM = 0
SELECT "visitType", count(*) FROM visits GROUP BY 1;

-- expect: both 0 (new tables start empty)
SELECT (SELECT count(*) FROM visit_assignments) AS assignments,
       (SELECT count(*) FROM admin_operations)  AS operations;

-- expect: 0 (new columns start NULL)
SELECT count(*) FROM subtasks
WHERE "carryForwardRequestedAt" IS NOT NULL
   OR "carryForwardApprovedAt"  IS NOT NULL
   OR "carryForwardRejectedAt"  IS NOT NULL;

-- expect: unchanged from the pre-migration counts
SELECT (SELECT count(*) FROM clients) c, (SELECT count(*) FROM visits) v,
       (SELECT count(*) FROM tasks) t,   (SELECT count(*) FROM subtasks) s;
```

---

## 6. Tests completed

| Check | Result |
|---|---|
| `npm ci` | clean |
| `npx tsc --noEmit` | clean |
| Root-mode production build | succeeds; no basePath baked in; no DB credentials in output |
| Company-mode build (`NEXT_PUBLIC_BASE_PATH` + standalone) | succeeds; basePath baked in; no credentials in client bundle |
| Prefixed server: routing, assets, images, favicon, cookies, auth, middleware redirect | 13/13 — nothing escapes the prefix |
| Migration rehearsal on a throwaway copy of the production schema | 27/27 — every pre-existing row byte-identical, new tables empty, idempotent |
| Post-migration schema drift vs `prisma/schema.prisma` | zero ("empty migration") |
| Delete-visit regression (`scripts/test-visit-deletion.mjs`) | 44/44 |
| Admin / Executive / Super Admin page + popup regression | all pass |
| Super Admin access restrictions | Admin and Executive receive 403 on every `/api/super-admin/*`; Super Admin allowed |
| Automatic carry-forward disabled | 18 forced sweeps created no visit and no carried subtask |
| Network | no duplicate requests, no polling loop, no request leaves localhost |
| Local database isolation | `localhost:5432/smc_task_dev` confirmed at runtime |

---

## 7. Known limitations and risks

1. **Migration must precede deployment.** See §1.
2. **Vercel environment variables were not verifiable from the development
   machine** (the CLI could not authenticate here). Confirm in the dashboard
   before deploying — see the deployment checklist.
3. **173 pending carry-forward requests** appear on first admin load (§4).
4. **Indexes are created non-concurrently** inside the migration transaction.
   On tables this size (949 subtasks, 2,437 logs) the lock is momentary; the
   alternative `CONCURRENTLY` form is in `prisma/sql/performance-indexes.sql`
   but cannot run inside a transaction.
5. **No rollback migration is provided.** Reversal would mean dropping the new
   columns and tables — destructive by definition. Rely on a Neon branch/backup
   taken before applying.
6. **`.env.example` is not committed** (`.gitignore` excludes `.env*`), so new
   developers have no template in the repository.
