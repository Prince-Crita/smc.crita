/**
 * build-standalone — produce the company-server deployment package.
 *
 * WHY THIS EXISTS
 * ---------------
 * The old approach was to ZIP the whole project folder. That ships your
 * .env.local, your .git history, your local node_modules (built for YOUR
 * machine and YOUR Node version) and every development artifact — which is
 * exactly where "it works here but not there" version mismatches come from.
 *
 * `next build` with output:"standalone" does the opposite. Next traces which
 * files the server actually needs at runtime and emits a minimal, self-contained
 * server: a server.js plus only the dependencies that are genuinely reached.
 * No `npm install` is needed on the company server.
 *
 * THE ONE THING NEXT DOES NOT DO FOR YOU
 * --------------------------------------
 * Next deliberately leaves `.next/static` and `public/` OUT of the standalone
 * folder, because most people serve those from a CDN. If you forget to copy
 * them in, the site loads but has NO CSS, NO JavaScript and NO images. That is
 * the single most common standalone deployment failure. This script copies
 * them, then verifies they arrived.
 *
 * USAGE (PowerShell)
 *   npm run build:standalone
 *   npm run build:standalone -- --base-path ""            # root-mounted build
 *   npm run build:standalone -- --out deployment/app-test
 *
 * Default mount point is /client-trial/smc-task-management, per
 * DEPLOYMENT_REVERSE_PROXY.md §1.
 *
 * NOTE ON PLATFORMS: build on the same OS as the server. The traced package can
 * include a platform-specific image library (@img/sharp-<platform>). Everything
 * else is portable — Prisma 7 here uses the WASM query compiler, so there is no
 * native database engine binary to match.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const DEFAULT_BASE_PATH = "/client-trial/smc-task-management";

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const basePath = argOf("--base-path", DEFAULT_BASE_PATH).replace(/\/$/, "");
const outDir = resolve(argOf("--out", "deployment/app"));
const root = process.cwd();

const step = (n, s) => console.log(`\n\x1b[1m[${n}]\x1b[0m ${s}`);
const info = (s) => console.log(`      ${s}`);
const die = (s) => { console.error(`\n\x1b[31mFAILED:\x1b[0m ${s}\n`); process.exit(1); };
const bytes = (n) => n > 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;

function dirSize(dir) {
  let total = 0, files = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { total += statSync(p).size; files++; }
    }
  };
  if (existsSync(dir)) walk(dir);
  return { total, files };
}

console.log("\n" + "═".repeat(72));
console.log(" SMC Task Management — standalone deployment package");
console.log("═".repeat(72));
info(`mount point : ${basePath || "(domain root)"}`);
info(`output      : ${outDir}`);

// ─── 1. toolchain check ─────────────────────────────────────────────────────
step(1, "Checking the toolchain matches what the package will expect");
const wanted = existsSync(".nvmrc") ? readFileSync(".nvmrc", "utf8").trim() : null;
const running = process.versions.node;
info(`node running: v${running}${wanted ? `   .nvmrc wants: v${wanted}` : ""}`);
if (wanted && running.split(".")[0] !== wanted.split(".")[0]) {
  die(`Node major version mismatch: running v${running}, .nvmrc requires v${wanted}.\n` +
      `         Build with the pinned version so the server runs what you tested.`);
}
info(`platform    : ${process.platform}-${process.arch}  (build on the same OS as the server)`);

// ─── 2. clean ───────────────────────────────────────────────────────────────
step(2, "Clearing any previous package so nothing stale is shipped");
if (existsSync(outDir)) { rmSync(outDir, { recursive: true, force: true }); info("removed the old output directory"); }
mkdirSync(outDir, { recursive: true });

// ─── 3. build ───────────────────────────────────────────────────────────────
step(3, "Building (prisma generate + next build)");
info("BUILD_STANDALONE=1 makes next.config.ts switch on output:'standalone'");
info(`NEXT_PUBLIC_BASE_PATH is read at BUILD TIME — it is compiled into every`);
info("asset URL, link and fetch. It cannot be changed later at startup.");
info("No database is contacted: the Prisma client is created lazily on first query.");

const buildEnv = {
  ...process.env,
  BUILD_STANDALONE: "1",
  NODE_ENV: "production",
  // A build must never inherit a stray connection string; nothing needs one.
  DATABASE_URL: undefined,
};
if (basePath) buildEnv.NEXT_PUBLIC_BASE_PATH = basePath;
else delete buildEnv.NEXT_PUBLIC_BASE_PATH;

const build = spawnSync("npm", ["run", "build"], {
  stdio: "inherit", env: buildEnv, shell: process.platform === "win32",
});
if (build.status !== 0) die("next build failed — nothing was packaged.");

// ─── 4. assemble ────────────────────────────────────────────────────────────
step(4, "Assembling the package");
const standalone = resolve(".next/standalone");
if (!existsSync(standalone)) die(".next/standalone was not produced. Is BUILD_STANDALONE=1 reaching next.config.ts?");

cpSync(standalone, outDir, { recursive: true });
info("copied .next/standalone  → the traced server and its runtime dependencies");

const staticSrc = resolve(".next/static");
if (!existsSync(staticSrc)) die(".next/static is missing — the build did not complete.");
cpSync(staticSrc, join(outDir, ".next/static"), { recursive: true });
info("copied .next/static      → CSS and JavaScript chunks  (Next omits these)");

if (existsSync("public")) {
  cpSync(resolve("public"), join(outDir, "public"), { recursive: true });
  info("copied public/           → logo, icons, images       (Next omits these)");
}

// ─── 5. strip anything secret or local ──────────────────────────────────────
step(5, "Removing anything that must never leave this machine");
let stripped = 0;
const strip = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      strip(p);
    } else if (/^\.env($|\.)/.test(e.name)) {
      rmSync(p); stripped++; info(`removed ${p.replace(outDir, ".")}`);
    }
  }
};
strip(outDir);
for (const junk of [".git", ".vercel", ".tmp-work", "tsconfig.tsbuildinfo"]) {
  const p = join(outDir, junk);
  if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); stripped++; info(`removed ${junk}`); }
}
info(stripped === 0 ? "nothing to remove — the package was already clean" : `${stripped} item(s) removed`);

// ─── 6. verify ──────────────────────────────────────────────────────────────
step(6, "Verifying the package can actually run");
// Only packages listed in next.config.ts `serverExternalPackages` stay as real
// files under node_modules. Everything else the server imports — jose, zod,
// date-fns, resend and so on — is COMPILED INTO .next/server by the bundler,
// so its absence from node_modules is correct, not a fault. Checking for those
// by directory name would report a healthy package as broken.
const checks = [
  ["server.js", join(outDir, "server.js"), "the Node entry point you will start"],
  [".next/static", join(outDir, ".next/static"), "CSS + JS chunks (missing ⇒ unstyled site)"],
  [".next/server", join(outDir, ".next/server"), "compiled pages and API routes"],
  ["public", join(outDir, "public"), "images and icons"],
  ["node_modules/@prisma/client", join(outDir, "node_modules/@prisma/client"), "Prisma runtime (kept external)"],
  ["node_modules/.prisma/client", join(outDir, "node_modules/.prisma/client"), "client generated for THIS schema"],
  ["node_modules/pg", join(outDir, "node_modules/pg"), "PostgreSQL driver (kept external)"],
  ["node_modules/bcryptjs", join(outDir, "node_modules/bcryptjs"), "password hashing (kept external)"],
];
let failed = 0;
for (const [label, path, why] of checks) {
  const ok = existsSync(path);
  if (!ok) failed++;
  console.log(`      ${ok ? "\x1b[32mOK  \x1b[0m" : "\x1b[31mMISS\x1b[0m"} ${label.padEnd(30)} ${why}`);
}
if (failed) die(`${failed} required item(s) missing from the package.`);

// Bundled-in code is verified by its string literals rather than by a folder.
const serverDir = join(outDir, ".next/server");
const grepAll = (needle) => {
  let hit = false;
  const walk = (d) => {
    if (hit) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (hit) return;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|mjs|cjs)$/.test(e.name)) {
        try { if (readFileSync(p, "utf8").includes(needle)) hit = true; } catch { /* skip */ }
      }
    }
  };
  if (existsSync(d0(serverDir))) walk(serverDir);
  return hit;
};
function d0(p) { return p; }
for (const [label, needle, why] of [
  ["jose (session JWT)", "ERR_JWT_EXPIRED", "compiled into .next/server, not a folder"],
]) {
  const ok = grepAll(needle);
  if (!ok) failed++;
  console.log(`      ${ok ? "\x1b[32mOK  \x1b[0m" : "\x1b[31mMISS\x1b[0m"} ${label.padEnd(30)} ${why}`);
}
if (failed) die(`${failed} bundled dependency missing — login would fail.`);

// The base path must be baked into the built assets, not merely intended.
const routesManifest = join(outDir, ".next/routes-manifest.json");
let bakedBasePath = "";
if (existsSync(routesManifest)) {
  try { bakedBasePath = JSON.parse(readFileSync(routesManifest, "utf8")).basePath ?? ""; } catch { /* ignore */ }
}
const bpOk = bakedBasePath === basePath;
console.log(`      ${bpOk ? "\x1b[32mOK  \x1b[0m" : "\x1b[31mBAD \x1b[0m"} ${"basePath compiled in".padEnd(30)} "${bakedBasePath}"${bpOk ? "" : `  — expected "${basePath}"`}`);
if (!bpOk) die("The mount point was not compiled into the build.");

for (const leak of [".env", ".env.local", ".env.development.local", ".env.build", ".env.production"]) {
  if (existsSync(join(outDir, leak))) die(`${leak} is present in the package — refusing to ship credentials.`);
}
console.log(`      \x1b[32mOK  \x1b[0m ${"no .env file in package".padEnd(30)} credentials stay on this machine`);

// ─── 7. manifest ────────────────────────────────────────────────────────────
step(7, "Writing BUILD-INFO.json so the server can be matched to this build");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const v = (n) => lock.packages?.[`node_modules/${n}`]?.version ?? "?";
let commit = "unknown";
try {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  if (r.status === 0) commit = r.stdout.trim();
} catch { /* not a git checkout */ }

const size = dirSize(outDir);
const manifest = {
  application: pkg.name,
  version: pkg.version,
  gitCommit: commit,
  builtAt: new Date().toISOString(),
  builtOn: `${process.platform}-${process.arch}`,
  node: `v${running}`,
  npm: spawnSync("npm", ["-v"], { encoding: "utf8", shell: process.platform === "win32" }).stdout?.trim() ?? "?",
  basePath: bakedBasePath || "(domain root)",
  dependencies: {
    next: v("next"), react: v("react"), "react-dom": v("react-dom"),
    prisma: v("prisma"), "@prisma/client": v("@prisma/client"),
    "@prisma/adapter-pg": v("@prisma/adapter-pg"), pg: v("pg"),
  },
  package: { files: size.files, bytes: size.total },
  requiredEnvAtRuntime: ["DATABASE_URL", "JWT_SECRET", "NODE_ENV=production", "PORT", "HOSTNAME"],
  optionalEnvAtRuntime: ["RESEND_API_KEY", "RESEND_FROM_EMAIL", "ADMIN_EMAIL", "JWT_EXPIRES_IN"],
};
writeFileSync(join(outDir, "BUILD-INFO.json"), JSON.stringify(manifest, null, 2) + "\n");
info(`node v${running} · next ${manifest.dependencies.next} · prisma ${manifest.dependencies.prisma}`);
info(`commit ${commit.slice(0, 12)} · ${size.files} files · ${bytes(size.total)}`);

console.log("\n" + "═".repeat(72));
console.log(" PACKAGE READY");
console.log("═".repeat(72));
console.log(`
 ${outDir}

 Start it (PowerShell), with the database and secret supplied by the
 environment — never from a file inside the package:

   npm run start:standalone           # uses .env.build

 or manually:

   $env:DATABASE_URL="postgresql://user:pass@host:5432/dbname"
   $env:JWT_SECRET="<at least 32 characters>"
   $env:NODE_ENV="production"
   $env:PORT="3000"
   $env:HOSTNAME="127.0.0.1"
   node ${join(outDir, "server.js").replace(root + "\\", "").replace(root + "/", "")}

 The mount point "${bakedBasePath || "(domain root)"}" is already compiled in.
 Do not set NEXT_PUBLIC_BASE_PATH at startup — it has no effect there.
`);
