# Deployment package

Everything the company server needs, and nothing else.

```
deployment/
├── app/                       the built application  (generated — NOT in git)
│   ├── server.js              ← what you start
│   ├── .next/                 compiled pages, API routes, CSS, JS
│   ├── public/                logo, icons, images
│   ├── node_modules/          only the traced runtime dependencies
│   └── BUILD-INFO.json        which commit/versions this package was built from
├── docs/
│   └── ROLLBACK.md            how to go back to Vercel if something is wrong
└── .env.company.example       environment template → copy to .env.build
```

`app/` is deliberately **not** committed. It is a build artifact, ~105 MB, and
regenerating it is one command. Committing it would mean the repository and the
running server could silently disagree.

---

## Generate the package

```powershell
npm ci                     # exact versions from package-lock.json
npm run build:standalone
```

Produces `deployment/app/`, mounted at `/client-trial/smc-task-management`.

For a different mount point:

```powershell
npm run build:standalone -- --base-path /some/other/path
npm run build:standalone -- --base-path ""      # domain root
```

The build contacts **no database**. It needs no credentials.

> Build on the same OS as the server. The traced package can include a
> platform-specific image library (`@img/sharp-<platform>`). Everything else is
> portable — Prisma 7 here uses the WASM query compiler, so there is no native
> database engine binary to match.

---

## Run it

```powershell
Copy-Item deployment\.env.company.example .env.build   # then fill in real values
npm run start:standalone
```

Or on the server, without the repository:

```bash
export DATABASE_URL='postgresql://…'
export JWT_SECRET='…at least 32 characters…'
export NODE_ENV=production
export PORT=3000
export HOSTNAME=127.0.0.1
node server.js
```

---

## Health check

There is no unauthenticated `/health` route — every API endpoint requires a
session by design. Use the login page instead; it is public, server-rendered
and touches the database only if you post to it.

```bash
BASE=https://<domain>/client-trial/smc-task-management
curl -sf -o /dev/null -w '%{http_code}\n' $BASE/login      # expect 200
```

For a monitor, treat **HTTP 200 from `$BASE/login`** as healthy. To confirm the
database is reachable too, post a deliberately wrong password and expect **401**
(not 500):

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"healthcheck@invalid","password":"not-a-real-password"}'
```

* `401` → the app queried the database and found no such user. Healthy.
* `500` → the database is unreachable or the schema is wrong. **Not** healthy.

---

## What must never be in this package

The build script enforces all of these and fails if any is present:

* any `.env` file (Next.js copies `.env.local` into the standalone output — the
  build script deletes it, which is the whole reason it exists)
* `.git`, `.vercel`, `.tmp-work`, `tsconfig.tsbuildinfo`
* local PostgreSQL data
* development-only dependencies

---

See `../COMPANY_SERVER_MIGRATION_GUIDE.md` for the full step-by-step migration,
and `../DEPLOYMENT_REVERSE_PROXY.md` for the proxy requirements.
