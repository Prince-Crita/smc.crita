# Migrating SMC Task Management to the company server

**From:** Vercel (application) + Neon PostgreSQL (database)
**To:** company server (Node.js) + company PostgreSQL, behind the company reverse proxy

This guide assumes you have not done this before. Every command says what it
does, why it is there, what you should see, and what a failure looks like.

> **The single most important fact:** `pg_dump` only **reads**. It cannot damage
> the live database. Until you switch traffic, production keeps running on
> Vercel exactly as it does today, and everything you do on the company server
> is a copy. See `deployment/docs/ROLLBACK.md`.

**This whole procedure has been rehearsed end to end** against a disposable
database on 22 Aug 2026. Every command below was executed and verified; the
results are in the session report.

---

## Table of contents

0. [Before you start](#0-before-you-start)
1. [Install Node.js](#1-install-nodejs)
2. [Install the PostgreSQL client tools](#2-install-the-postgresql-client-tools)
3. [Get the code and its exact dependencies](#3-get-the-code-and-its-exact-dependencies)
4. [Understand which database each command uses](#4-understand-which-database-each-command-uses)
5. [Dump the Neon database](#5-dump-the-neon-database)
6. [Inspect the dump before trusting it](#6-inspect-the-dump-before-trusting-it)
7. [Create the company database](#7-create-the-company-database)
8. [Restore](#8-restore)
9. [Verify the restore](#9-verify-the-restore)
10. [What Prisma does and does not do here](#10-what-prisma-does-and-does-not-do-here)
11. [Configure the environment](#11-configure-the-environment)
12. [Build the deployment package](#12-build-the-deployment-package)
13. [Start the application](#13-start-the-application)
14. [Configure the reverse proxy](#14-configure-the-reverse-proxy)
15. [Test everything](#15-test-everything)
16. [Switch traffic](#16-switch-traffic)
17. [If something goes wrong](#17-if-something-goes-wrong)

---

## 0. Before you start

You need, written down and to hand:

| Thing | Where it comes from |
|---|---|
| Neon connection string | the existing `.env.build`, or the Neon dashboard |
| Company PostgreSQL host, port, admin user, password | your DBA / server team |
| The mount point | `/client-trial/smc-task-management` (already agreed) |
| `JWT_SECRET` | **reuse the current one** from `.env.build` — see §11 |
| Somewhere safe for the dump file | it contains all your business data |

Pick a **quiet hour**. The migration itself is safe at any time, but the moment
you switch traffic is the moment the two databases start to diverge.

**Write down the exact UTC timestamp when you switch traffic.** If you ever
need to roll back after users have entered data, that timestamp is the
difference between a 20-minute recovery and a very bad day.

---

## 1. Install Node.js

**What:** the runtime that executes the application.
**Why this exact version:** the package is built and tested against it. A
different major version is the usual cause of "it works on my machine".

The required version is pinned in two places in the repository:

* `.nvmrc` → `22.19.0`
* `package.json` → `"engines": { "node": ">=22.19.0 <23", "npm": ">=10.9.0" }`

```powershell
node --version
npm --version
```

**Expect:**
```
v22.19.0
10.9.3
```

**Failure looks like:** `v20.x` or `v24.x`. Install Node 22 LTS from
<https://nodejs.org>, or with nvm:

```bash
nvm install 22.19.0 && nvm use 22.19.0     # nvm reads .nvmrc automatically
```

Node 22 is fine. A different **major** version is not — that is what `engines`
is there to catch.

---

## 2. Install the PostgreSQL client tools

**What:** `pg_dump`, `pg_restore` and `psql` — the standard PostgreSQL command
line tools.
**Why:** they are how you copy a PostgreSQL database. Neon *is* PostgreSQL, so
the ordinary tools work against it with no special treatment.

```powershell
pg_dump --version
pg_restore --version
psql --version
```

**Expect:** `pg_dump (PostgreSQL) 18.x` (or newer) three times.

**Failure looks like:** `'pg_dump' is not recognized`.

### If they are not installed

**Do not install random software.** You need exactly one thing: the official
PostgreSQL **client tools**, version **18 or newer**.

* **Windows** — the EnterpriseDB installer from
  <https://www.postgresql.org/download/windows/>. During installation you may
  **uncheck "PostgreSQL Server"** and keep only **"Command Line Tools"** if you
  do not want a local server.
* **Debian / Ubuntu** — `sudo apt install postgresql-client-18`
* **RHEL / Rocky** — `sudo dnf install postgresql18`

### Version rule — this one matters

> **`pg_dump` must be the same major version as the server it dumps, or newer.**

Neon runs **PostgreSQL 18**. So `pg_dump` must be **18 or newer**. A version 16
`pg_dump` pointed at an 18 server refuses to run:

```
pg_dump: error: server version: 18.6; pg_dump version: 16.4
pg_dump: error: aborting because of server version mismatch
```

That error is protective, not a bug — an older `pg_dump` does not understand
newer catalog features and would produce a subtly wrong dump.

Check the company server's PostgreSQL version too:

```powershell
psql "postgresql://USER:PASSWORD@COMPANY_HOST:5432/postgres" -c "SELECT version();"
```

It must be **major version 18** as well. Restoring an 18 dump into a 16 server
will fail. Restoring into 19+ would work but is untested — keep the majors equal.

### On this machine

The tools are installed but **not on `PATH`**. Add them for the session:

```powershell
$env:PATH = "D:\Program Files\PostgreSQL\18\bin;" + $env:PATH
pg_dump --version        # now works
```

---

## 3. Get the code and its exact dependencies

```powershell
git clone <repository-url> smc-task-management
cd smc-task-management
git checkout main
npm ci
```

**`npm ci`, not `npm install` — this is the fix for your ZIP mismatch problem.**

| | `npm install` | `npm ci` |
|---|---|---|
| reads | `package.json` | `package-lock.json` |
| may pick newer versions | **yes** | no |
| may rewrite the lockfile | yes | never |
| result on two machines | can differ | byte-identical |

`package.json` says `"next": "16.2.9"` but also `"pg": "^8.22.0"` — the `^`
means "8.22.0 or any newer 8.x". On a machine where you run `npm install` a
month later, you get 8.23.0. `npm ci` reads `package-lock.json`, which records
the exact resolved version of every package, and installs precisely that.

**Expect:** `added NNNN packages, and audited NNNN packages in Xs`.

**Failure looks like:** `npm ci can only install packages when your
package.json and package-lock.json are in sync` — someone edited
`package.json` without running `npm install`. Fix it in the repository, commit
the updated lockfile, and pull again.

---

## 4. Understand which database each command uses

Before touching anything, ask the project:

```powershell
npm run db:target
```

This connects to nothing. It reads the environment files and prints, for each
command, the host and database it would use — never a password.

**Expect** the local database for `npm run dev`, and your company database for
`npm run start:standalone`.

### How the environment files work

Next.js loads env files by **name**, and the names depend on `NODE_ENV`:

```
NODE_ENV=development :  .env.development.local → .env.local → .env.development → .env
NODE_ENV=production  :  .env.production.local  → .env.local → .env.production  → .env
```

The first file that defines a variable wins. **Anything already set in your
shell outranks all of them.**

`.env.build` is **not on either list**. Next.js will never load it by itself.
That is deliberate: it is what makes it safe to keep the production connection
string there. `npm run dev` cannot reach it by accident.

| Command | Environment | Database |
|---|---|---|
| `npm run dev` | `.env.development.local`, `.env.local` | **local only** — the app refuses to start against a remote one |
| `npm run build` / `build:standalone` | none needed | **none** — the build never connects |
| `npm run start:standalone` | `.env.build`, loaded explicitly | the company database |
| `npx prisma <cmd>` | `.env.development.local`, `.env.local` | **local** by default |

### Running something against `.env.build` on purpose

```powershell
npm run start:standalone
```

which is shorthand for:

```powershell
node scripts/with-env.mjs .env.build --expect-remote -- node deployment/app/server.js
```

`with-env.mjs` reads the named file and passes the values as **real process
environment variables** — the one input that already outranks every `.env` file
in Next.js. That is why it does not fight the precedence rules above.

It also protects you from the trap that catches everyone:

```
────────────────────────────────────────────────────────────────────────
 REFUSING TO RUN: your shell sets variables this env file does not.

   $env:DATABASE_URL   is set in your PowerShell session

 .env.build does not define it, so your shell value would reach the
 application unchanged — the exact way a command meant for one
 environment ends up running against another.

 Clear them, then run again:
   $env:DATABASE_URL=$null
────────────────────────────────────────────────────────────────────────
```

**If you ever see strange behaviour, check your shell first:**

```powershell
$env:DATABASE_URL ; $env:NODE_ENV ; $env:PORT
```

Clear anything unexpected with `$env:NAME=$null`. A shell variable survives for
the whole terminal session and silently outranks every file.

---

## 5. Dump the Neon database

**What:** reads the entire production database into one file.
**Why:** this file *is* the migration. Everything after this is local.

```powershell
$env:PATH = "D:\Program Files\PostgreSQL\18\bin;" + $env:PATH

pg_dump `
  --format=custom `
  --no-owner `
  --no-privileges `
  --verbose `
  --file="smc-neon-2026-08-23.dump" `
  "postgresql://USER:PASSWORD@ep-xxxx-pooler.region.aws.neon.tech/dbname?sslmode=require"
```

Take the connection string from `.env.build` (the `DATABASE_URL` line).

### Why each option

| Option | What it does | Why you need it |
|---|---|---|
| `--format=custom` | compressed binary archive | lets `pg_restore` list contents, restore selectively, and run in parallel. A plain `.sql` file can only be replayed start to finish. |
| `--no-owner` | omits `ALTER … OWNER TO neondb_owner` | the company server has no role called `neondb_owner`. Without this, the restore errors on **every single object**. |
| `--no-privileges` | omits `GRANT` / `REVOKE` | those also reference Neon-only roles. |
| `--verbose` | progress per object | so a stall is visible rather than silent. |
| `--file=` | writes to a file | avoids shell redirection mangling binary output on Windows. |

**Do not use:**

* `--data-only` or `--schema-only` — you need both. The default gives both.
* `--clean` — emits `DROP` statements. Into an empty database they are
  pointless; into a populated one they are destructive.
* `--create` — emits `CREATE DATABASE` with Neon's settings. Create the
  database yourself (§7) so you control encoding and ownership.

### What the dump preserves

Everything in the database. Concretely, for this application:

| | Preserved |
|---|---|
| `clients` | ✅ every row and column |
| `visits` (incl. `visitType`, status, dates, notes, `summaryJson`) | ✅ |
| `tasks` | ✅ |
| `subtasks` (incl. completion, progress, incompletion reasons) | ✅ |
| carry-forward history (`isCarriedForward`, `sourceSubtaskId`, `carryForwardRequestedAt`/`ApprovedAt`/`ApprovedById`/`RejectedAt`) | ✅ |
| `users` / executives (incl. password hashes — everyone's password keeps working) | ✅ |
| `attendance` (punch in/out, working minutes, notes) | ✅ |
| `leave_requests` | ✅ |
| `subtask_templates` | ✅ |
| `client_task_types` | ✅ |
| `visit_assignments` (team lead / members) | ✅ |
| `visit_reassignments`, `visit_delegations` | ✅ |
| `activity_logs` | ✅ |
| `admin_operations` (undo/redo history) | ✅ |
| calendar data | ✅ — there is no separate calendar table; the calendar is rendered from `visits.scheduledDate`, so it comes across with the visits |
| **enums** (`VisitStatus`, `VisitType`, `VisitRole`, `Role`, `ActivityAction`, …) | ✅ as `CREATE TYPE` |
| **indexes** (all 40) | ✅ |
| **primary keys** (14) | ✅ |
| **foreign keys** (25) | ✅ |
| **unique / check constraints** | ✅ — Prisma's `@@unique` is implemented as a unique *index*, so it arrives with the indexes |
| **defaults** | ✅ |
| **sequences and their current values** | ✅ — this schema has none; ids are `cuid()`/`uuid()` strings, not `serial` counters |

**Not preserved** (and not needed):

* database **roles/users** — those live at the PostgreSQL *server* level, not in
  the database. Create the app's role on the company server yourself (§7).
* Neon-specific settings, connection pooling, branches.

**Expect:** a file of a few hundred KB to a few MB, and:
```
pg_dump: last built-in OID is 16383
pg_dump: reading extensions
...
pg_dump: dumping contents of table "public.visits"
```

**Failure looks like:**

| Message | Meaning |
|---|---|
| `aborting because of server version mismatch` | `pg_dump` is older than the server — §2 |
| `could not translate host name` | typo in the host, or no network |
| `password authentication failed` | wrong credentials |
| `SSL connection has been closed unexpectedly` | add `?sslmode=require` |

---

## 6. Inspect the dump before trusting it

**What:** lists what is inside without restoring anything.
**Why:** a truncated or empty dump looks like a perfectly normal file.

```powershell
pg_restore --list "smc-neon-2026-08-23.dump" | Measure-Object -Line
pg_restore --list "smc-neon-2026-08-23.dump" | Select-String "TABLE DATA"
```

**Expect** roughly 100+ entries, including one `TABLE DATA` line per table —
`clients`, `visits`, `tasks`, `subtasks`, `users`, `attendance`,
`leave_requests`, `subtask_templates`, `client_task_types`,
`visit_assignments`, `visit_reassignments`, `visit_delegations`,
`activity_logs`, `admin_operations` (14 tables).

Also check the file is not suspiciously small:

```powershell
(Get-Item "smc-neon-2026-08-23.dump").Length
```

**Failure looks like:** `pg_restore: error: did not find magic string in file
header` — the dump is truncated or was written as text. Dump again.

**Now copy this file somewhere safe.** It is a complete point-in-time backup of
production and it stays valid forever.

---

## 7. Create the company database

**What:** an empty database, and a role for the application to log in as.
**Why:** restoring into an existing populated database is how you overwrite
data you meant to keep.

```powershell
psql "postgresql://ADMIN:PASSWORD@COMPANY_HOST:5432/postgres" -v ON_ERROR_STOP=1 `
  -c "CREATE ROLE smc_app WITH LOGIN PASSWORD 'a-strong-password';" `
  -c "CREATE DATABASE smc_task_management OWNER smc_app ENCODING 'UTF8' TEMPLATE template0;"
```

`TEMPLATE template0` gives a pristine database with no objects inherited from
`template1`.

### Safety check — the target MUST be empty

```powershell
psql "postgresql://ADMIN:PASSWORD@COMPANY_HOST:5432/smc_task_management" `
  -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
```

**Expect exactly `0`.**

> ### STOP if this is not 0
> Something already exists in that database. Restoring on top would mix two
> datasets and could overwrite live data. Find out what it is and get
> agreement before continuing. **Do not** use `--clean` to "fix" it.

---

## 8. Restore

```powershell
pg_restore `
  --dbname="postgresql://smc_app:PASSWORD@COMPANY_HOST:5432/smc_task_management" `
  --no-owner `
  --no-privileges `
  --exit-on-error `
  --verbose `
  "smc-neon-2026-08-23.dump"
```

### Why each option

| Option | Why |
|---|---|
| `--no-owner` | ignore the Neon ownership recorded in the dump; objects become owned by the connecting role |
| `--no-privileges` | skip `GRANT`s referring to Neon-only roles |
| `--exit-on-error` | **stop at the first problem.** Without it `pg_restore` continues past errors and reports "completed" with data missing — the most dangerous default in this whole procedure |
| `--verbose` | see each object as it is created |

**Never use** `--clean`, `--if-exists` or `--create` here. All of them emit
`DROP` statements.

**Expect:** object-by-object output, then a silent exit with status 0.

**Failure looks like:**

| Message | Meaning |
|---|---|
| `role "neondb_owner" does not exist` | you forgot `--no-owner` |
| `relation "visits" already exists` | the target was not empty — go back to §7 |
| `violates foreign key constraint` | a partial/corrupt dump. Drop the database, dump again |

Restoring into an empty database is safe to repeat: drop, recreate, restore.

---

## 9. Verify the restore

**"No errors" is not the same as "the data is correct."** A restore can succeed
while skipping a constraint or dropping rows a foreign key rejected.

```powershell
node scripts/verify-restore.mjs `
  --source "postgresql://USER:PASSWORD@ep-xxxx-pooler.region.aws.neon.tech/dbname?sslmode=require" `
  --target "postgresql://smc_app:PASSWORD@COMPANY_HOST:5432/smc_task_management"
```

This is **read-only on both databases** — it opens each connection inside
`BEGIN TRANSACTION READ ONLY`, so the PostgreSQL server itself rejects any
write. It cannot modify production.

It checks:

0. same PostgreSQL major version
1. **same tables, and identical row counts** in every one
2. **content fingerprints** — every column of every row hashed, so a *changed*
   row is caught, not just a missing one
3. **schema objects** — enums and their labels, every index, primary keys,
   foreign keys, unique and check constraints, sequence positions
4. **referential integrity** — no orphan tasks, subtasks, visits, assignments,
   attendance, leave, activity logs, templates, or carry-forward pointers
5. **business spot-checks** — completed subtasks, carried-forward subtasks,
   pending carry-forward requests, visits by status, team visits, active
   executives, attendance rows, approved leave, total progress points

**Expect:**
```
 ALL CHECKS PASSED — 35 checks. The restore is faithful.
```

> ### STOP if any check fails
> Do not continue. Drop the company database, recreate it (§7) and restore
> again (§8). If it fails a second time, the dump is bad — dump again (§5).
> **Do not "fix" the target database by hand.**

---

## 10. What Prisma does and does not do here

This is where people get into trouble, so read it carefully.

```
pg_dump / pg_restore  →  moves the DATABASE: the schema AND all the data
Prisma schema         →  describes what the APPLICATION expects
Prisma migrations     →  would evolve a schema over time
```

**They are different jobs.** `pg_restore` brings the schema across *with* the
data, so after §8 the company database already has the correct structure.

### This project has no `prisma/migrations` directory

Schema changes here have been applied as reviewed SQL (see
`prisma/sql/2026-08-21-production-migration.sql`), not through Prisma Migrate.
That means:

* `prisma migrate deploy` **has nothing to apply** — there is no migration
  history for it to read.
* You do not need it. The restore already carried the schema.

### Confirm the restored schema matches the code

```powershell
$env:DATABASE_URL = "postgresql://smc_app:PASSWORD@COMPANY_HOST:5432/smc_task_management"
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma
$env:DATABASE_URL = $null      # always clear it again
```

**Expect exactly:**
```
No difference detected.
```

That single line is the proof that the database the app will use matches the
schema the code was written against. It is read-only and writes nothing.

> ### STOP if it reports differences
> It will print the SQL that *would* change the database. **Do not run it**
> against the company database without review — it may drop or alter columns.
> Bring it to whoever owns the schema.

### Commands you must NOT run against the company database

| Command | What it would do |
|---|---|
| `prisma migrate reset` | **drops every table and all data.** Never. |
| `prisma db push` | force-aligns the database to the schema — can drop columns and data without a migration or a prompt |
| `prisma db seed` | inserts development seed data on top of real data |

The project already defends you: `prisma.config.ts` makes the Prisma CLI default
to the **local** database and prints its target on every run:

```
[prisma] target: host=localhost db=smc_task_dev
```

If you ever see a company or Neon host on that line, stop and check what you set.

### The one Prisma command you DO need

```powershell
npx prisma generate
```

This reads `prisma/schema.prisma` and writes the typed client into
`node_modules/.prisma/client`. It touches **no database**. `npm run build`
already runs it, so you rarely call it directly.

---

## 11. Configure the environment

```powershell
Copy-Item deployment\.env.company.example .env.build
notepad .env.build
```

Fill in:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the **company** database (§7) |
| `JWT_SECRET` | **the current production value** — see below |
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `HOSTNAME` | `127.0.0.1` |

### About `JWT_SECRET`

It signs session cookies. If you change it, **every signed-in user is logged
out** the moment you switch. Sessions last 7 days, so that is potentially
everyone.

Reuse the existing production secret (from the current `.env.build`) and nobody
notices the migration. Only generate a new one if you have reason to believe the
old one leaked:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Confirm before continuing

```powershell
npm run db:target
```

`npm run start:standalone` must now show your **company** database — not Neon,
not localhost.

`.env.build` is gitignored and is never copied into the deployment package.

---

## 12. Build the deployment package

```powershell
npm run build:standalone
```

**What it does, in order:**

1. checks Node matches `.nvmrc`
2. clears any previous package
3. runs `prisma generate` + `next build` with `BUILD_STANDALONE=1` and
   `NEXT_PUBLIC_BASE_PATH=/client-trial/smc-task-management`
4. copies `.next/standalone` → `deployment/app`
5. copies `.next/static` and `public/` in — **Next leaves these out**, and
   forgetting them is *the* classic standalone failure: the page loads with no
   CSS, no JavaScript and no images
6. **deletes any `.env` file** Next copied in (it does copy `.env.local`)
7. verifies the package can actually run
8. writes `BUILD-INFO.json`

**The build contacts no database and needs no credentials.**

`NEXT_PUBLIC_BASE_PATH` is read at **build time** and compiled into every asset
URL, link and API call. Setting it at startup does nothing. To change the mount
point you must rebuild.

**Expect:**
```
[6] Verifying the package can actually run
      OK   server.js                      the Node entry point you will start
      OK   .next/static                   CSS + JS chunks (missing ⇒ unstyled site)
      OK   node_modules/.prisma/client    client generated for THIS schema
      OK   basePath compiled in           "/client-trial/smc-task-management"
      OK   no .env file in package        credentials stay on this machine

 PACKAGE READY
```

**Failure looks like** any `MISS` line, or `Node major version mismatch`.

> **Build on the same OS as the server.** The package can include a
> platform-specific image library (`@img/sharp-<platform>`). A package built on
> Windows will not run its image optimiser on Linux. Everything else is
> portable — Prisma 7 here uses the WASM query compiler, so there is no native
> database engine binary to match.

Copy `deployment/app/` to the server (rsync, scp, or a zip of that folder
only — **not** the project folder).

---

## 13. Start the application

```powershell
npm run start:standalone
```

On the server, without the repository:

```bash
cd /opt/smc-task-management
export DATABASE_URL='postgresql://smc_app:PASSWORD@127.0.0.1:5432/smc_task_management'
export JWT_SECRET='…'
export NODE_ENV=production
export PORT=3000
export HOSTNAME=127.0.0.1
node server.js
```

**Expect:**
```
▲ Next.js 16.2.9
- Local:        http://127.0.0.1:3000
✓ Ready in 0ms
```

**Failure looks like:**

| Symptom | Cause |
|---|---|
| `DATABASE_URL environment variable is not set` | the variable did not reach the process |
| `EADDRINUSE` | something else is on port 3000 |
| starts, but pages 500 | database unreachable or schema wrong — recheck §9 and §10 |

### Keep it running

**systemd** (`/etc/systemd/system/smc-task.service`):

```ini
[Unit]
Description=SMC Task Management
After=network.target postgresql.service

[Service]
Type=simple
User=smc
WorkingDirectory=/opt/smc-task-management
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=127.0.0.1
EnvironmentFile=/etc/smc-task/env      # chmod 600 — holds DATABASE_URL + JWT_SECRET
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now smc-task
sudo systemctl status smc-task
```

---

## 14. Configure the reverse proxy

Full requirements: `DEPLOYMENT_REVERSE_PROXY.md` §4. The rule that matters most:

> **Forward the request URI UNCHANGED. Do not strip the prefix.**

The application is built expecting `/client-trial/smc-task-management/...` and
removes the prefix itself. If the proxy removes it too, everything 404s.

```nginx
location /client-trial/smc-task-management/ {
    proxy_pass http://127.0.0.1:3000;      # NO trailing URI — this is the point

    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade           $http_upgrade;
    proxy_set_header Connection        "upgrade";
}
```

`proxy_pass http://127.0.0.1:3000` and `proxy_pass http://127.0.0.1:3000/`
differ by one character and one breaks the whole site. **The trailing slash is
what strips the prefix.**

Also required:

* **Terminate TLS.** Under `NODE_ENV=production` session cookies are issued
  `Secure`, so the browser must reach the site over `https://` or it drops the
  cookie and **login fails silently**. Plain HTTP between proxy and app is fine.
* **Proxy the whole subtree**, `_next/*` included.
* **Pass cookies and `Host` / `X-Forwarded-*` through.**
* **Do not enable response-body rewriting** (`sub_filter`). It would corrupt
  React Server Component payloads.

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### Test the proxy before going further

```powershell
npm run proxy:simulate                    # correct: forwards unchanged
npm run proxy:simulate -- --strip         # deliberately wrong, so you can see it
```

Open `http://localhost:8080/client-trial/smc-task-management/login`. With
`--strip` you get 404s and an unstyled page — memorise that appearance; it is
exactly what a misconfigured `proxy_pass` looks like.

---

## 15. Test everything

```bash
BASE=https://<domain>/client-trial/smc-task-management

curl -sI  $BASE/login                        # 200
curl -sI  $BASE/ | grep -i location          # MUST still contain the prefix
curl -sI  $BASE/favicon-32.png               # 200
```

If the redirect drops the prefix, the proxy is stripping it — §14.

Then open `$BASE/login` in a browser with DevTools → Network:

| # | Check | Pass |
|---|---|---|
| 1 | login page is **styled**, logo visible | CSS and images resolve under the prefix |
| 2 | **no 404s** in Network; every request starts with `/client-trial/smc-task-management/` | base path correct throughout |
| 3 | wrong password → "Invalid email or password" | database reachable, hashes intact |
| 4 | correct password → dashboard | sessions work, cookie accepted over TLS |
| 5 | Admin → Clients: expected client count | data restored |
| 6 | Admin → Visits: progress percentages look right | subtasks and completion restored |
| 7 | Admin → Calendar: visits on the right dates | scheduling intact |
| 8 | open a **team** visit — lead and members shown | `visit_assignments` restored |
| 9 | sign in as a **team member**: same visit, same tasks | team scoping works |
| 10 | member tries to close the team visit → refused | lead-only close intact |
| 11 | Admin → Carry Forward: pending requests listed | carry-forward history restored |
| 12 | approve one to a date, assigning an executive | approval workflow works |
| 13 | executive: reschedule a carry-forward item | rescheduling works, no duplicate visit |
| 14 | executive: punch in, then punch out **without a note** → refused | attendance rule intact |
| 15 | punch out **with** a note → accepted | note stored |
| 16 | Admin → Attendance shows it | attendance readable |
| 17 | Admin → Leave: existing requests present | leave restored |
| 18 | tick a subtask; refresh; still ticked | writes reach the company database |
| 19 | Admin → Task Configuration: templates present | templates and client task types restored |
| 20 | delete a **test** visit as admin | deletion works |

Re-run the row-count comparison after testing:

```powershell
node scripts/verify-restore.mjs --source "<neon-url>" --target "<company-url>"
```

Counts will now differ slightly **only** for rows your own testing created.
Everything else must still match.

---

## 16. Switch traffic

Only when §15 passes completely.

1. **Note the exact UTC time.** `[DateTime]::UtcNow.ToString("o")`
2. Point DNS or the proxy at the company server.
3. Watch: `sudo journalctl -u smc-task -f`
4. Sign in yourself and re-check two or three screens.
5. Tell the team the app has moved.
6. **Leave Vercel and Neon running for at least a week.** They cost little idle
   and they are your rollback (`deployment/docs/ROLLBACK.md`).

### After the switch

* Neon becomes read-only history. Do not delete it yet.
* Keep the dump file — it is a permanent point-in-time backup.
* Set up backups on the company database. Nobody is doing this for you now:
  ```bash
  0 2 * * * pg_dump --format=custom --no-owner --no-privileges \
    --file=/backups/smc-$(date +\%F).dump \
    "postgresql://smc_app:PASSWORD@127.0.0.1:5432/smc_task_management"
  ```
  **This is the single most important thing to arrange after the migration.**
  Vercel + Neon were doing it for you; the company server is not.

---

## 17. If something goes wrong

**Before traffic is switched, nothing is at risk.** The Neon database is
untouched and Vercel is still serving. Stop, fix, retry.

| Symptom | Likely cause | Fix |
|---|---|---|
| Page loads but no styling | proxy strips the prefix, or `.next/static` missing | §14 / rebuild §12 |
| Every request 404 | `proxy_pass` has a trailing slash | §14 |
| Login "works" but bounces back to login | cookie dropped — site not served over HTTPS | terminate TLS §14 |
| `P2022` / `P2021` in logs | database does not match the code | §9, §10 |
| `password authentication failed` at startup | wrong `DATABASE_URL` | §11 |
| App starts, all pages 500 | database unreachable from the server | firewall / `pg_hba.conf` |
| Users report missing data | restore incomplete | re-run §9 — **do not hand-edit** |

Full rollback procedure, per stage: `deployment/docs/ROLLBACK.md`.

---

## Command summary

```powershell
# toolchain
node --version                       # v22.19.0
pg_dump --version                    # 18.x or newer

# dependencies
npm ci

# check which database each command uses
npm run db:target

# dump  (READ-ONLY on production)
pg_dump --format=custom --no-owner --no-privileges --verbose `
        --file="smc-neon-2026-08-23.dump" "<neon-url>"

# inspect
pg_restore --list "smc-neon-2026-08-23.dump"

# create target
psql "<company-admin-url>/postgres" -c "CREATE DATABASE smc_task_management ENCODING 'UTF8' TEMPLATE template0;"

# restore
pg_restore --dbname="<company-url>" --no-owner --no-privileges --exit-on-error --verbose `
           "smc-neon-2026-08-23.dump"

# verify  (READ-ONLY on both)
node scripts/verify-restore.mjs --source "<neon-url>" --target "<company-url>"

# schema matches the code?
$env:DATABASE_URL="<company-url>"
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma   # "No difference detected."
$env:DATABASE_URL=$null

# build and run
npm run build:standalone
npm run start:standalone
```
