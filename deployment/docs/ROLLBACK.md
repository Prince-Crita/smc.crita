# Rollback — going back to Vercel + Neon

Read this **before** you start the migration, not during it.

---

## The one fact that makes rollback safe

`pg_dump` **reads**. It never modifies the source. So throughout the migration
the Neon database stays live, complete and untouched, and Vercel keeps serving
from it exactly as it does today.

Nothing you do on the company server can damage production — **until** users
start entering data on the company server. That single moment is the point of
no easy return, because from then on the two databases diverge.

```
   Neon (live, untouched) ──► pg_dump ──► file ──► pg_restore ──► company DB
        ▲                                                              │
        └── Vercel still serving from here ────────────────────────────┘
                                                          (users still here
                                                           until you switch)
```

---

## Rollback at each stage

### Stage 1 — before you switch traffic

Everything so far is a copy. Nothing to roll back.

* Stop the company Node process.
* Leave DNS / the reverse proxy pointing at Vercel.
* Optionally drop the company database: `DROP DATABASE smc_task_management;`

**Users notice nothing.** Vercel never stopped serving.

---

### Stage 2 — traffic switched, but no one has entered data yet

Point the reverse proxy (or DNS) back at the Vercel URL.

```bash
# nginx: revert the location block to the Vercel origin, then
sudo nginx -t && sudo systemctl reload nginx
```

Confirm: `curl -sI https://<vercel-url>/login` → 200.

The Neon database still holds everything. **No data is lost**, because nothing
new was written on the company side.

---

### Stage 3 — traffic switched AND users have entered data

This is the expensive case. You now have real work in **both** places:

* Neon: everything up to the switchover.
* Company DB: everything since.

You cannot simply switch back — you would lose whatever was entered on the
company server. Choose deliberately:

**Option A — stay on the company server and fix forward.** Usually right. The
data is all in one place; fix whatever is broken.

**Option B — go back to Vercel and carry the new data across.** Only if the
company server is unusable. This is a manual merge:

1. Announce a freeze. Stop the company Node process so nothing more is written.
2. Dump the company database.
3. Identify rows created after the switchover — every table carries `createdAt`:
   ```sql
   SELECT * FROM visits   WHERE "createdAt" > '<switchover timestamp UTC>';
   SELECT * FROM subtasks WHERE "updatedAt" > '<switchover timestamp UTC>';
   ```
4. Re-enter or script those into Neon, **in foreign-key order**:
   `users → clients → visits → visit_assignments → tasks → subtasks`,
   then `attendance`, `leave_requests`, `activity_logs`.
5. Verify with `node scripts/verify-restore.mjs` before letting anyone back in.

There is no automated path for this. **That is why you minimise the window in
Stage 2 — verify thoroughly before letting users on.**

---

## Reduce the risk before you switch

* **Do the whole migration once as a rehearsal**, exactly as documented, and
  only then for real.
* **Switch at the quietest hour.** Fewest users mid-task, smallest divergence
  window.
* **Record the exact switchover timestamp in UTC.** Option B is far easier with
  it and painful without it.
* **Keep the dump file.** It is a point-in-time backup of production, good
  forever. Store it somewhere safe — it contains all your business data.
* **Do not delete anything on Neon** for at least a week after a successful
  migration. Vercel and Neon cost little idle, and they are your safety net.

---

## Quick reference

| Situation | Action | Data loss |
|---|---|---|
| Company build fails | keep using Vercel | none |
| Restore verification fails | drop the company DB, re-restore | none |
| App starts but pages are broken | keep Vercel, investigate offline | none |
| Traffic switched, no user data yet | point the proxy back at Vercel | none |
| Traffic switched, users have worked | fix forward, or manual merge (§Stage 3) | possible — plan carefully |

---

## Verify a rollback worked

```bash
curl -sI https://<vercel-url>/login                  # 200
```

Then sign in and confirm a recent visit still shows its correct progress. If
the number matches what users expect, the rollback is complete.
