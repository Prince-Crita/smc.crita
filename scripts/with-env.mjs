/**
 * with-env — run a command with ONE explicitly named environment file.
 *
 * WHY THIS EXISTS
 * ---------------
 * Next.js loads env files by a fixed set of NAMES that depend on NODE_ENV:
 *
 *   development :  .env.development.local → .env.local → .env.development → .env
 *   production  :  .env.production.local  → .env.local → .env.production  → .env
 *
 * `.env.build` is not on that list, so Next never loads it on its own. That is
 * exactly what makes it safe to keep the company/production connection string
 * there: `npm run dev` cannot reach it by accident.
 *
 * But it also means there is no built-in way to say "run this with .env.build".
 * Rather than invent a mechanism that fights the precedence above, this script
 * uses the ONE input that already outranks every .env file in Next.js: the real
 * process environment. It reads the named file itself and hands the values to
 * the child process as actual environment variables. Next then sees them as
 * shell variables and honours them ahead of any .env file — documented,
 * predictable behaviour, no conflict.
 *
 * THE SILENT-OVERRIDE PROBLEM IT SOLVES
 * -------------------------------------
 * A variable left over in your PowerShell session — a stray $env:DATABASE_URL
 * or $env:NODE_ENV from an earlier command — outranks every file and applies
 * without a word. That is precisely how a "local" command ends up talking to a
 * production database.
 *
 * So for a watched set of variables this script:
 *   • REFUSES to run when one is set in your shell but NOT defined in the env
 *     file — because the shell value would silently pass through to the app;
 *   • ANNOUNCES the ones it is overriding, so nothing changes quietly.
 *
 * Pass --allow-shell-env to proceed anyway (a deliberate act, not an accident).
 *
 * USAGE
 *   node scripts/with-env.mjs <env-file> [--expect-local|--expect-remote]
 *                             [--allow-shell-env] -- <command> [args...]
 *
 * EXAMPLES (PowerShell)
 *   node scripts/with-env.mjs .env.build --expect-remote -- node deployment/app/server.js
 *   node scripts/with-env.mjs .env.development.local --expect-local -- npx prisma studio
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Variables that decide WHERE the app connects and HOW it behaves. A stray
// shell value for any of these is a real hazard, not a nuisance.
const WATCHED = [
  "DATABASE_URL",
  "NODE_ENV",
  "PORT",
  "HOSTNAME",
  "JWT_SECRET",
  "NEXT_PUBLIC_BASE_PATH",
  "ALLOW_REMOTE_DB",
];

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

const die = (lines) => {
  console.error("\n" + "─".repeat(72));
  for (const l of [].concat(lines)) console.error(l);
  console.error("─".repeat(72) + "\n");
  process.exit(1);
};

// ─── arguments ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
if (sep === -1 || sep === 0) {
  die([
    " with-env: nothing to run.",
    "",
    " usage: node scripts/with-env.mjs <env-file> [flags] -- <command> [args]",
    " flags: --expect-local | --expect-remote | --allow-shell-env",
  ]);
}
const flags = argv.slice(0, sep);
const command = argv.slice(sep + 1);
const envFile = flags.find((f) => !f.startsWith("--"));
const expectLocal = flags.includes("--expect-local");
const expectRemote = flags.includes("--expect-remote");
const allowShellEnv = flags.includes("--allow-shell-env");

if (!envFile) die(" with-env: no env file given (first argument).");
const envPath = resolve(process.cwd(), envFile);
if (!existsSync(envPath)) {
  die([
    ` with-env: ${envFile} not found at ${envPath}`,
    "",
    " This file is deliberately NOT in git (it holds credentials).",
    " Copy .env.example and fill it in, or ask whoever holds the values.",
  ]);
}

// ─── parse the env file (KEY=VALUE, # comments, optional quotes) ────────────
/** @returns {Map<string,string>} */
function parseEnvFile(text) {
  const out = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out.set(key, value);
  }
  return out;
}

const fileVars = parseEnvFile(readFileSync(envPath, "utf8"));
if (fileVars.size === 0) die(` with-env: ${envFile} defines no variables.`);

// ─── shell-override detection ───────────────────────────────────────────────
const shadowed = [];   // set in shell AND in the file — the file wins, announce it
const leaking = [];    // set in shell, NOT in the file — would apply silently
for (const key of WATCHED) {
  if (process.env[key] === undefined) continue;
  (fileVars.has(key) ? shadowed : leaking).push(key);
}

if (leaking.length > 0 && !allowShellEnv) {
  die([
    " REFUSING TO RUN: your shell sets variables this env file does not.",
    "",
    ...leaking.map((k) => `   $env:${k}   is set in your PowerShell session`),
    "",
    ` ${envFile} does not define ${leaking.length === 1 ? "it" : "them"}, so your shell value`,
    " would reach the application unchanged — the exact way a command meant",
    " for one environment ends up running against another.",
    "",
    " Clear them, then run again:",
    ...leaking.map((k) => `   $env:${k}=$null`),
    "",
    " Or, if you truly mean to keep them, re-run with --allow-shell-env.",
  ]);
}

// ─── build the child environment: file values WIN over the shell ────────────
const childEnv = { ...process.env };
for (const [k, v] of fileVars) childEnv[k] = v;

// ─── report, without ever printing a secret ─────────────────────────────────
function describe(url) {
  if (!url) return { text: "<unset>", isRemote: false };
  try {
    const u = new URL(url);
    return {
      text: `host=${u.hostname} port=${u.port || "5432"} db=${decodeURIComponent(u.pathname.replace(/^\//, "").split("?")[0])} user=${decodeURIComponent(u.username)}`,
      isRemote: !LOCAL_HOSTS.has(u.hostname),
      isNeon: /\bneon\.tech$/i.test(u.hostname),
    };
  } catch {
    return { text: "<unparseable>", isRemote: true };
  }
}

const target = describe(childEnv.DATABASE_URL);
console.log("┌" + "─".repeat(70));
console.log(`│ env file : ${envFile}`);
console.log(`│ variables: ${[...fileVars.keys()].join(", ")}`);
console.log(`│ database : ${target.text}${target.isNeon ? "   ⚠ NEON — this is the LIVE production database" : ""}`);
console.log(`│ NODE_ENV : ${childEnv.NODE_ENV ?? "<unset>"}`);
if (shadowed.length) console.log(`│ overriding shell vars: ${shadowed.join(", ")}  (${envFile} wins)`);
if (leaking.length) console.log(`│ ⚠ passing through shell vars: ${leaking.join(", ")}  (--allow-shell-env)`);
console.log(`│ command  : ${command.join(" ")}`);
console.log("└" + "─".repeat(70));

if (expectLocal && target.isRemote) {
  die([" REFUSING TO RUN: --expect-local, but the database is REMOTE.", `   ${target.text}`]);
}
if (expectRemote && !target.isRemote) {
  die([" REFUSING TO RUN: --expect-remote, but the database is LOCAL.", `   ${target.text}`]);
}

// ─── run ────────────────────────────────────────────────────────────────────
const child = spawn(command[0], command.slice(1), {
  stdio: "inherit",
  env: childEnv,
  shell: process.platform === "win32", // resolves .cmd shims (npm, npx) on Windows
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
child.on("error", (err) => die([` with-env: could not start "${command[0]}"`, `   ${err.message}`]));
