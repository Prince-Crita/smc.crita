/**
 * db:target — answer "which database will each command talk to?"
 *
 * Reads every environment file WITHOUT connecting to anything and prints the
 * host / port / database / user it resolves to. Passwords are never read out.
 *
 * Run this whenever you are unsure — especially before a Prisma command, and
 * before any deployment step.
 *
 *   npm run db:target
 */
import { existsSync, readFileSync } from "node:fs";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

function parse(text) {
  const out = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out.set(key, v);
  }
  return out;
}

function describe(url) {
  if (!url) return "— (no DATABASE_URL in this file)";
  try {
    const u = new URL(url);
    const remote = !LOCAL_HOSTS.has(u.hostname);
    const neon = /\bneon\.tech$/i.test(u.hostname);
    const db = decodeURIComponent(u.pathname.replace(/^\//, "").split("?")[0]);
    return `host=${u.hostname} port=${u.port || "5432"} db=${db} user=${decodeURIComponent(u.username)}` +
      (neon ? "   ⚠ NEON — LIVE PRODUCTION" : remote ? "   ⚠ remote" : "   (local)");
  } catch {
    return "<unparseable>";
  }
}

// Next.js load order, per NODE_ENV. `.env.build` is deliberately absent from
// both lists — Next never loads it, which is why it is safe to keep the
// production connection string there.
const NEXT_DEV = [".env.development.local", ".env.local", ".env.development", ".env"];
const NEXT_PROD = [".env.production.local", ".env.local", ".env.production", ".env"];

console.log("\n═══ environment files present ═══");
for (const f of [".env.development.local", ".env.local", ".env.production.local", ".env.production", ".env", ".env.build", ".env.example"]) {
  if (!existsSync(f)) continue;
  const vars = parse(readFileSync(f, "utf8"));
  console.log(`\n  ${f}`);
  console.log(`    defines : ${[...vars.keys()].join(", ") || "(nothing)"}`);
  console.log(`    database: ${describe(vars.get("DATABASE_URL"))}`);
}

// What each command actually resolves to.
function resolveFor(list) {
  for (const f of list) {
    if (!existsSync(f)) continue;
    const url = parse(readFileSync(f, "utf8")).get("DATABASE_URL");
    if (url) return { file: f, url };
  }
  return null;
}

console.log("\n═══ what each command will use ═══\n");

const shell = process.env.DATABASE_URL;
if (shell) {
  console.log("  ⚠ $env:DATABASE_URL IS SET IN YOUR SHELL — it outranks every file below.");
  console.log(`      ${describe(shell)}`);
  console.log("      clear it with:  $env:DATABASE_URL=$null\n");
}

const dev = resolveFor(NEXT_DEV);
console.log(`  npm run dev                → ${dev ? describe(dev.url) : "<none>"}`);
console.log(`      (first file that defines it: ${dev ? dev.file : "none"}; guard refuses if remote)`);

const prod = resolveFor(NEXT_PROD);
console.log(`\n  npm run build / start      → ${prod ? describe(prod.url) : "— (none; the build needs no database)"}`);
console.log(`      (a production build never opens a connection — the Prisma client is lazy)`);

const build = existsSync(".env.build") ? parse(readFileSync(".env.build", "utf8")).get("DATABASE_URL") : null;
console.log(`\n  npm run start:standalone   → ${describe(build)}`);
console.log(`      (.env.build, loaded explicitly by scripts/with-env.mjs — never automatically)`);

console.log(`\n  npx prisma <cmd>           → ${dev ? describe(dev.url) : "<none>"}`);
console.log(`      (prisma.config.ts loads .env.development.local then .env.local)`);
console.log("");
