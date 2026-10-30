/**
 * Production schema migration — check and apply.
 *
 * Modes:
 *
 *   node scripts/production-migration.mjs check
 *       READ-ONLY. Opens a `BEGIN TRANSACTION READ ONLY` (so the server itself
 *       rejects any write), reports which required objects exist, prints row
 *       counts and a content fingerprint of every table, and compares the
 *       WHOLE schema with expected-schema.json (when present): anything the
 *       application needs that this migration would not create is reported as
 *       a STOP. Safe to run at any time, before or after the migration.
 *
 *   node scripts/production-migration.mjs apply
 *       Applies every file in MIGRATION_FILES, in order. Refuses to run
 *       unless CONFIRM_PRODUCTION_MIGRATION=yes is set, so it cannot happen by
 *       accident. Each file is one transaction: it either completes or changes
 *       nothing. All are additive only — no DROP, TRUNCATE, DELETE, UPDATE,
 *       INSERT, ALTER COLUMN, RENAME or SET NOT NULL — and idempotent, so
 *       re-running them (or running them on a database that already has some
 *       of them) is safe. Every existing table is fingerprinted before and
 *       after (row count + hash of every row, the columns this release adds
 *       left out), proving no existing row was added, removed or changed.
 *
 *   node scripts/production-migration.mjs export-schema <file>
 *       READ-ONLY. Writes the database's schema as JSON. Used to produce
 *       expected-schema.json from a database that `prisma migrate diff`
 *       confirms matches prisma/schema.prisma.
 *
 * Runs from the repository (SQL in prisma/sql/) or from the deployment
 * package (SQL in database/sql/, `pg` taken from app/node_modules).
 *
 * The connection string must be supplied explicitly, so there is no way to run
 * this against the wrong database by leaving a file lying around:
 *
 *   DATABASE_URL="postgresql://..." node scripts/production-migration.mjs check
 *
 * Take a database backup before applying. Nothing here can restore data,
 * because nothing here removes any.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { createRequire } from "module";
import { dirname, join, relative } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));

// Release migrations, in the order they must run. Each is additive and
// idempotent; a database that already has some of them is simply topped up.
const MIGRATION_FILES = [
  "2026-08-21-production-migration.sql",  // team visits, admin-approved carry-forward, indexes
  "2026-10-24-visit-task-selection.sql",  // visits.selectedTaskTypes
  "2026-10-30-visit-subtask-selection.sql", // visits.selectedSubtaskTemplateIds
  "2026-10-30-leave-half-day.sql",        // LeaveType, HalfDayPeriod, leave_requests columns
  "2026-10-31-visit-photos.sql",          // visit_photos
];
const SQL_DIR = [join(here, "sql"), join(here, "..", "prisma", "sql")].find((d) => existsSync(d));
const EXPECTED_SCHEMA = [join(here, "expected-schema.json"), join(here, "..", "prisma", "sql", "expected-schema.json")].find((f) => existsSync(f));

// Columns this release adds to EXISTING tables. They are left out of the data
// fingerprint, so "unchanged" means every pre-existing value is unchanged.
const NEW_COLUMNS = ["selectedTaskTypes", "selectedSubtaskTemplateIds", "leaveType", "halfDayPeriod"];

// `pg` from the repository's node_modules, or from the deployment package's app.
function loadPg() {
  for (const from of [import.meta.url, join(here, "..", "app", "server.js")]) {
    try { return createRequire(from)("pg"); } catch { /* try the next location */ }
  }
  console.error("Cannot find the 'pg' module (expected in node_modules or app/node_modules).");
  process.exit(2);
}
const pg = loadPg();

const mode = (process.argv[2] || "check").toLowerCase();

if (!["check", "apply", "export-schema"].includes(mode) || (mode === "export-schema" && !process.argv[3])) {
  console.error("Usage: node scripts/production-migration.mjs [check|apply|export-schema <file>]");
  process.exit(2);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  console.error('Pass it explicitly:  DATABASE_URL="postgresql://..." node scripts/production-migration.mjs check');
  process.exit(2);
}

let target;
try {
  const u = new URL(url);
  target = { host: u.hostname, db: u.pathname.replace(/^\//, "").split("?")[0], user: u.username };
} catch {
  console.error("DATABASE_URL is not a valid connection string.");
  process.exit(2);
}

const isLocal = ["localhost", "127.0.0.1", "::1"].includes(target.host);
const shortHost = isLocal ? target.host : target.host.replace(/^([^.]{0,12}).*$/, "$1….(hidden)");

if (mode === "apply" && process.env.CONFIRM_PRODUCTION_MIGRATION !== "yes") {
  console.error("");
  console.error("  Refusing to apply without an explicit confirmation.");
  console.error(`  Target: host=${shortHost} db=${target.db} user=${target.user}`);
  console.error("");
  console.error("  If that is the database you mean, re-run with:");
  console.error(`    CONFIRM_PRODUCTION_MIGRATION=yes node ${relative(process.cwd(), process.argv[1]).replace(/\\/g, "/")} apply`);
  console.error("");
  process.exit(2);
}

const REQUIRED = {
  tables: ["visit_assignments", "admin_operations", "visit_photos"],
  enums: ["VisitType", "VisitRole", "LeaveType", "HalfDayPeriod"],
  columns: [
    ["visits", "visitType"],
    ["subtasks", "carryForwardRequestedAt"],
    ["subtasks", "carryForwardApprovedAt"],
    ["subtasks", "carryForwardApprovedById"],
    ["subtasks", "carryForwardRejectedAt"],
    ["visits", "selectedTaskTypes"],
    ["visits", "selectedSubtaskTemplateIds"],
    ["leave_requests", "leaveType"],
    ["leave_requests", "halfDayPeriod"],
  ],
  indexes: [
    "visits_clientId_idx", "visits_executiveId_idx", "visits_scheduledDate_idx",
    "visits_status_idx", "visits_updatedAt_idx",
    "subtasks_isCarriedForward_idx", "subtasks_carryForwardRequestedAt_idx",
    "subtasks_sourceSubtaskId_idx", "subtask_templates_clientId_taskType_idx",
    "visit_reassignments_visitId_idx", "activity_logs_visitId_idx",
    "activity_logs_userId_createdAt_idx", "activity_logs_action_createdAt_idx",
    "visit_delegations_visitId_idx", "visit_delegations_toExecutiveId_status_idx",
    "admin_operations_createdAt_idx", "visit_assignments_visitId_executiveId_key",
    "visit_photos_s3Key_key", "visit_photos_visitId_idx",
  ],
};

const COUNT_TABLES = ["users", "clients", "visits", "tasks", "subtasks", "activity_logs", "attendance", "leave_requests"];

const client = new pg.Client({
  connectionString: url,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

async function report(q) {
  const tables = (await q(`select table_name from information_schema.tables where table_schema='public'`)).map((r) => r.table_name);
  const cols = new Set((await q(`select table_name, column_name from information_schema.columns where table_schema='public'`)).map((r) => `${r.table_name}.${r.column_name}`));
  const enums = (await q(`select t.typname from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public'`)).map((r) => r.typname);
  const idx = (await q(`select indexname from pg_indexes where schemaname='public'`)).map((r) => r.indexname);

  let missing = 0;
  const line = (present, label) => { if (!present) missing++; console.log(`  ${present ? "present" : "MISSING"}  ${label}`); };

  console.log("\nEnum types");
  for (const e of REQUIRED.enums) line(enums.includes(e), e);
  console.log("Tables");
  for (const t of REQUIRED.tables) line(tables.includes(t), t);
  console.log("Columns");
  for (const [t, c] of REQUIRED.columns) line(cols.has(`${t}.${c}`), `${t}.${c}`);
  console.log("Indexes");
  let idxMissing = 0;
  for (const i of REQUIRED.indexes) if (!idx.includes(i)) idxMissing++;
  console.log(`  ${idxMissing === 0 ? "present" : "MISSING"}  ${REQUIRED.indexes.length - idxMissing}/${REQUIRED.indexes.length} performance indexes`);
  missing += idxMissing;

  console.log("\nRow counts (unchanged by this migration)");
  for (const t of COUNT_TABLES) {
    if (!tables.includes(t)) continue;
    const [{ c }] = await q(`select count(*)::int c from "${t}"`);
    console.log(`  ${t.padEnd(16)} ${c}`);
  }

  if (tables.includes("visits") && cols.has("visits.visitType")) {
    const rows = await q(`select "visitType", count(*)::int c from visits group by 1 order by 1`);
    console.log(`\n  visits by type: ${rows.map((r) => `${r.visitType}=${r.c}`).join(", ")}`);
  }
  if (tables.includes("visit_assignments")) {
    const [{ c }] = await q(`select count(*)::int c from visit_assignments`);
    console.log(`  visit_assignments rows: ${c}  (0 expected immediately after migration)`);
  }
  if (tables.includes("admin_operations")) {
    const [{ c }] = await q(`select count(*)::int c from admin_operations`);
    console.log(`  admin_operations rows:  ${c}  (0 expected immediately after migration)`);
  }
  if (cols.has("leave_requests.leaveType")) {
    const rows = await q(`select "leaveType", count(*)::int c from leave_requests group by 1 order by 1`);
    console.log(`  leave requests by type: ${rows.map((r) => `${r.leaveType}=${r.c}`).join(", ") || "(none)"}  (all FULL_DAY right after migration)`);
  }
  if (tables.includes("visit_photos")) {
    const [{ c }] = await q(`select count(*)::int c from visit_photos`);
    console.log(`  visit_photos rows:      ${c}  (0 expected immediately after migration)`);
  }
  return missing;
}

// ─── Whole-schema comparison ──────────────────────────────────────────────────

async function schemaOf(q) {
  const cols = await q(`select table_name t, column_name c, udt_name ty, is_nullable = 'YES' nl, column_default df
    from information_schema.columns where table_schema='public' order by 1, 2`);
  const enums = await q(`select t.typname e, v.enumlabel l from pg_type t join pg_enum v on v.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace where n.nspname='public' order by 1, v.enumsortorder`);
  const idx = await q(`select indexname i, tablename t from pg_indexes where schemaname='public' order by 1`);
  const fks = await q(`select c.conname n, cl.relname t from pg_constraint c join pg_class cl on cl.oid = c.conrelid
    join pg_namespace n on n.oid = c.connamespace where n.nspname='public' and c.contype='f' order by 1`);
  const s = { tables: {}, enums: {}, indexes: {}, foreignKeys: {} };
  for (const r of cols) (s.tables[r.t] ??= {})[r.c] = { type: r.ty, nullable: r.nl, default: r.df };
  for (const r of enums) (s.enums[r.e] ??= []).push(r.l);
  for (const r of idx) s.indexes[r.i] = r.t;
  for (const r of fks) s.foreignKeys[r.n] = r.t;
  return s;
}

/** Objects the release migration files create (parsed from the files themselves). */
function releaseObjects() {
  const set = new Set();
  for (const name of MIGRATION_FILES) {
    const sql = readFileSync(join(SQL_DIR, name), "utf8").replace(/--[^\n]*/g, "");
    for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS "(\w+)"/g)) set.add(`table ${m[1]}`);
    for (const m of sql.matchAll(/ALTER TABLE "(\w+)"([^;]*)/g)) {
      for (const c of m[2].matchAll(/ADD COLUMN IF NOT EXISTS "(\w+)"/g)) set.add(`column ${m[1]}.${c[1]}`);
    }
    for (const m of sql.matchAll(/CREATE TYPE "(\w+)"/g)) set.add(`enum ${m[1]}`);
    for (const m of sql.matchAll(/INDEX\s+IF NOT EXISTS\s+"(\w+)"/g)) set.add(`index ${m[1]}`);
    for (const m of sql.matchAll(/ADD CONSTRAINT "(\w+)"/g)) set.add(`foreign key ${m[1]}`);
  }
  return set;
}

/**
 * Compare the live schema with the expected one. Extra objects in the live
 * database are ignored. Returns what is missing (split by whether `apply`
 * creates it), what differs in type/nullability, and differing defaults.
 */
function compareSchema(exp, act, created) {
  const out = { byApply: [], notByApply: [], different: [], defaults: [] };
  const miss = (label, table) => (created.has(label) || (table && created.has(`table ${table}`)) ? out.byApply : out.notByApply).push(label);
  for (const [t, cols] of Object.entries(exp.tables)) {
    if (!act.tables[t]) { miss(`table ${t}`, t); continue; }
    for (const [c, d] of Object.entries(cols)) {
      const a = act.tables[t][c];
      const fmt = (x) => `${x.type}${x.nullable ? "" : " NOT NULL"}`;
      if (!a) miss(`column ${t}.${c}`);
      else if (a.type !== d.type || a.nullable !== d.nullable) out.different.push(`${t}.${c}: expected ${fmt(d)}, found ${fmt(a)}`);
      else if ((a.default ?? null) !== (d.default ?? null)) out.defaults.push(`${t}.${c}: expected default ${d.default ?? "none"}, found ${a.default ?? "none"}`);
    }
  }
  for (const [e, labels] of Object.entries(exp.enums)) {
    if (!act.enums[e]) { miss(`enum ${e}`); continue; }
    for (const l of labels) if (!act.enums[e].includes(l)) miss(`enum value ${e}.${l}`);
  }
  for (const [i, t] of Object.entries(exp.indexes)) if (!(i in act.indexes)) miss(`index ${i}`, t);
  for (const [f, t] of Object.entries(exp.foreignKeys)) if (!(f in act.foreignKeys)) miss(`foreign key ${f}`, t);
  return out;
}

function printSchemaComparison(cmp, when) {
  console.log(`\nWhole schema vs ${EXPECTED_SCHEMA ? "expected-schema.json" : "(no expected-schema.json found — skipped)"}`);
  if (!EXPECTED_SCHEMA) return;
  const list = (title, items) => { if (items.length) { console.log(`  ${title}:`); for (const i of items) console.log(`    - ${i}`); } };
  list(when === "before" ? "missing — created by apply" : "STILL MISSING", cmp.byApply);
  list("MISSING and NOT created by this migration — STOP", cmp.notByApply);
  list("DIFFERENT type/nullability — STOP", cmp.different);
  list("different column default (note)", cmp.defaults);
  if (!cmp.byApply.length && !cmp.notByApply.length && !cmp.different.length) console.log("  matches: every table, column, enum value, index and foreign key the application needs is present");
}

// ─── Existing-data fingerprint ────────────────────────────────────────────────

const quoteIdent = (s) => `"${s.replace(/"/g, '""')}"`;

async function fingerprint(q) {
  const tables = (await q(`select table_name t from information_schema.tables
    where table_schema='public' and table_type='BASE TABLE' order by 1`)).map((r) => r.t);
  const out = {};
  for (const t of tables) {
    const [r] = await q(`select count(*)::int n, md5(coalesce(string_agg(h, '' order by h), '')) h
      from (select md5((to_jsonb(x) - $1::text[])::text) h from ${quoteIdent(t)} x) s`, [NEW_COLUMNS]);
    out[t] = r;
  }
  return out;
}

function printFingerprint(fp) {
  console.log("\nExisting data fingerprint (row count · content hash; release columns excluded)");
  for (const [t, r] of Object.entries(fp)) console.log(`  ${t.padEnd(22)} ${String(r.n).padStart(7)} · ${r.h}`);
}

async function main() {
  await client.connect();
  const q = async (sql, p) => (await client.query(sql, p ?? [])).rows;
  console.log(`\ntarget: host=${shortHost} db=${target.db} user=${target.user}`);

  if (mode === "export-schema") {
    await client.query("BEGIN TRANSACTION READ ONLY");
    const s = await schemaOf(q);
    await client.query("ROLLBACK");
    writeFileSync(process.argv[3], JSON.stringify(s, null, 1) + "\n");
    console.log(`schema written to ${process.argv[3]}: ${Object.keys(s.tables).length} tables, ${Object.keys(s.enums).length} enums, ${Object.keys(s.indexes).length} indexes, ${Object.keys(s.foreignKeys).length} foreign keys`);
    await client.end();
    process.exit(0);
  }

  if (!SQL_DIR) throw new Error("migration SQL folder not found (expected sql/ next to this script, or prisma/sql/)");
  const expected = EXPECTED_SCHEMA ? JSON.parse(readFileSync(EXPECTED_SCHEMA, "utf8")) : null;
  const created = releaseObjects();

  if (mode === "check") {
    await client.query("BEGIN TRANSACTION READ ONLY");
    console.log("mode:   CHECK (read-only transaction — the server rejects any write)");
    const missing = await report(q);
    const cmp = expected ? compareSchema(expected, await schemaOf(q), created) : null;
    if (cmp) printSchemaComparison(cmp, "before");
    printFingerprint(await fingerprint(q));
    await client.query("ROLLBACK");
    await client.end();
    if (cmp && (cmp.notByApply.length || cmp.different.length)) {
      console.log("\nRESULT: STOP — the database differs from what this release needs in ways the migration does NOT fix (listed above). Do not apply or deploy; send this output to the developers.");
      process.exit(1);
    }
    console.log(missing === 0 && (!cmp || !cmp.byApply.length)
      ? "\nRESULT: the database already has everything this release needs."
      : `\nRESULT: required objects are missing, and all of them are created by "apply" — safe to apply.`);
    process.exit(0);
  }

  // apply
  console.log("mode:   APPLY");
  if (expected) {
    const pre = compareSchema(expected, await schemaOf(q), created);
    if (pre.notByApply.length || pre.different.length) {
      printSchemaComparison(pre, "before");
      console.log("\nRESULT: STOP — nothing was applied. The database differs from what this release needs in ways the migration does NOT fix.");
      await client.end();
      process.exit(1);
    }
  }
  const before = await fingerprint(q);
  console.log(`existing data fingerprinted: ${Object.keys(before).length} tables, ${Object.values(before).reduce((s, r) => s + r.n, 0)} rows`);
  for (const name of MIGRATION_FILES) {
    const file = join(SQL_DIR, name);
    if (!existsSync(file)) throw new Error(`missing migration file ${name} — nothing after it was applied`);
    const sql = readFileSync(file, "utf8");
    process.stdout.write(`running ${name} … `);
    const t0 = Date.now();
    await client.query(sql); // each file carries its own BEGIN/COMMIT
    console.log(`done in ${Date.now() - t0}ms`);
  }
  console.log("");

  console.log("Verifying:");
  const missing = await report(q);
  const after = await fingerprint(q);
  console.log("\nExisting data, before vs after");
  const changed = [];
  for (const [t, r] of Object.entries(before)) {
    const a = after[t];
    const same = a && a.n === r.n && a.h === r.h;
    if (!same) changed.push(t);
    console.log(`  ${t.padEnd(22)} ${String(r.n).padStart(7)} rows  ${same ? "unchanged" : `CHANGED (now ${a ? a.n : "missing"} rows)`}`);
  }
  for (const t of Object.keys(after)) if (!(t in before)) console.log(`  ${t.padEnd(22)} ${String(after[t].n).padStart(7)} rows  new table`);
  const cmp = expected ? compareSchema(expected, await schemaOf(q), created) : null;
  if (cmp) printSchemaComparison(cmp, "after");
  await client.end();
  const schemaOk = !cmp || (!cmp.byApply.length && !cmp.notByApply.length && !cmp.different.length);
  if (changed.length) {
    console.log(`\nRESULT: existing data in ${changed.join(", ")} changed while the migration ran. The migration itself writes no rows — was the application still running? Do NOT deploy; compare with the backup first.`);
    process.exit(1);
  }
  console.log(missing === 0 && schemaOk
    ? "\nRESULT: migration applied and verified — existing data unchanged, schema complete. The code can now be deployed."
    : `\nRESULT: the schema is still incomplete (listed above) — do NOT deploy; investigate first.`);
  process.exit(missing === 0 && schemaOk ? 0 : 1);
}

main().catch(async (err) => {
  console.error("\nFAILED:", err.message);
  console.error("Each migration file runs in its own transaction: files reported \"done\" are applied,");
  console.error("the failing file changed nothing, and later files were not run. Re-running is safe.");
  try { await client.end(); } catch {}
  process.exit(1);
});
