# SMC Task Management — company-server deployment

Single standalone Next.js (App Router) application. Frontend pages and API
routes run in one process; there is no separate backend to deploy.

```
browser → company reverse proxy → node server.js → /api/* route handlers → PostgreSQL
```

Route files are always authored as `/api/*`, `/admin/*`, `/executive/*`. That
never changes. The public mount point is added by the framework at the edges.

---

## 1. Two modes, one switch

| Where | `NEXT_PUBLIC_BASE_PATH` | URLs |
|---|---|---|
| Local development / existing Vercel deployment | **unset** | `http://localhost:3000/`, `/api/...` |
| Company server behind the proxy | `/client-trial/smc-task-management` | `https://<domain>/client-trial/smc-task-management/…/api/...` |

With the variable unset the build is equivalent to the previous behaviour, so
localhost and Vercel are unaffected.

---

## 2. Build the deployment package

`NEXT_PUBLIC_BASE_PATH` is read at **BUILD TIME** — it must be set for
`npm run build`, not only at startup.

```powershell
npm ci
npm run build:standalone
```

No database and no credentials are needed to build — the Prisma client is
created lazily on first query, so `next build` never opens a connection.

`scripts/build-standalone.mjs` does all of this:

1. checks the running Node matches `.nvmrc`
2. `NEXT_PUBLIC_BASE_PATH=/client-trial/smc-task-management BUILD_STANDALONE=1 npm run build`
3. copies `.next/standalone/` → `deployment/app/`
4. copies `.next/static` and `public/` into it (Next does **not** include these
   in the standalone output — this is the single most common cause of "the page
   loads but there is no CSS/JS")
5. deletes any `.env*` file Next copied in, so no secret ever ships —
   Next **does** copy `.env.local`, so this step is not theoretical
6. verifies the package: entry point, static assets, Prisma client, the
   PostgreSQL driver, the base path actually compiled into `routes-manifest.json`,
   and that no `.env` file survived
7. writes `BUILD-INFO.json` recording the commit, Node/npm and dependency
   versions the package was built from

To build for a different mount point:
`npm run build:standalone -- --base-path /some/other/path`
(`--base-path ""` builds for the domain root.)

> **Build on the same OS as the server.** The package includes a native image
> library (`node_modules/@img/sharp-<platform>`). A package built on Windows
> carries `sharp-win32-x64` and its image optimiser will not run on a Linux
> server. Build on the target OS (or in a matching container). Everything else
> in the package is platform-independent — Prisma 7 here uses the portable WASM
> query compiler, so there is no native database engine to worry about.

---

## 3. Run it

```bash
cd deployment/app
export DATABASE_URL='postgresql://…'
export JWT_SECRET='…at least 32 characters…'
export NODE_ENV=production
export PORT=3000
export HOSTNAME=127.0.0.1        # bind locally; the proxy is the public face
node server.js
```

The base path is already compiled into the package — it does not need to be set
again at runtime. Use a process manager (systemd, pm2, Windows service) to keep
it running.

---

## 4. What the reverse proxy must do

We do not know which server software you use, so these are requirements, not a
config file.

1. **Forward the request URI UNCHANGED — do NOT strip the prefix.**
   The app is built to receive `/client-trial/smc-task-management/...` and
   strips the prefix itself. In nginx terms: `proxy_pass http://127.0.0.1:3000;`
   *without* a trailing URI — adding a trailing `/` is what strips the prefix
   and will break the app.
2. **Proxy the entire subtree**, `.../\_next/*` included. Everything is served
   under the prefix; nothing needs to exist at the domain root.
3. **Terminate TLS.** Session cookies are issued `Secure` under
   `NODE_ENV=production`, so the browser must reach the site over `https://` or
   it will drop the cookie and login will silently fail. Plain HTTP between the
   proxy and the app is fine.
4. **Pass cookies and `Host`/`X-Forwarded-*` through** as usual.
5. **Do not enable response-body rewriting** (`sub_filter` and friends). It is
   unnecessary and would corrupt React Server Component payloads.

---

## 5. Post-deployment checks

```bash
BASE=https://<domain>/client-trial/smc-task-management
curl -sI  $BASE/login                 # 200
curl -sI  $BASE/ | grep -i location   # must KEEP the prefix
curl -sI  $BASE/favicon-32.png        # 200
curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
     -d '{"identifier":"someone@…","password":"…"}' -i | head -5
```

Then open `$BASE/login` in a browser and check:

* the page is **styled** and the logo shows (if not, the proxy is stripping the
  prefix — requirement 1),
* logging in works and lands on the dashboard,
* DevTools → Network shows **no 404s** and every request starting with
  `/client-trial/smc-task-management/`.

---

## 6. Environment variables

Full list in `.env.example`. Required on the company server:

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `JWT_SECRET` | yes | Session signing key, ≥32 chars |
| `NEXT_PUBLIC_BASE_PATH` | yes, **at build time** | Mount point |
| `BUILD_STANDALONE` | `1`, at build time | Emit the standalone server |
| `RESEND_API_KEY` | no | Visit-close summary emails; skipped silently if unset |
| `RESEND_FROM_EMAIL` / `ADMIN_EMAIL` | no | Sender / recipient for the above |

Never copy a `.env` file into the deployment package. The hosted database
connection string lives in `.env.build` (gitignored, and never loaded by
Next.js on its own); `.env.local` holds the shared secrets. Set the server's own
values in the process environment instead — systemd `EnvironmentFile=`, a pm2
ecosystem file, or a Windows service definition.

`deployment/.env.company.example` is the template to copy and fill in.

To run the built package locally against `.env.build`:

```powershell
npm run start:standalone
```

That goes through `scripts/with-env.mjs`, which loads exactly one named env
file, refuses to start when a stray shell variable would silently override it,
and prints the resolved database host before running. `npm run db:target` shows
which database every command would use, without connecting to anything.

---

## 7. Android app

`capacitor.config.ts` points the APK at the existing Vercel URL and is
unrelated to this deployment. Nothing here changes it.
