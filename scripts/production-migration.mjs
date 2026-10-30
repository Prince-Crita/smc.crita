/**
 * Production schema migration — check and apply.
 *
 * Two modes:
 *
 *   node scripts/production-migration.mjs check
 *       READ-ONLY. Opens a `BEGIN TRANSACTION READ ONLY` (so the server itself
 *       rejects any write), reports which required objects exist, and prints
 *       row counts. Safe to run at any time, before or after the migration.
 *
 *   node scripts/production-migration.mjs apply
 *       Applies every file in MIGRATION_FILES, in order. Refuses to run
 *       unless CONFIRM_PRODUCTION_MIGRATION=yes is set, so it cannot happen by
 *       accident. Each file is one transaction: it either completes or changes
 *       nothing. All are additive only — no DROP, TRUNCATE, DELETE, UPDATE,
 *       INSERT, ALTER COLUMN, RENAME or SET NOT NULL — and idempotent, so
 *       re-running them (or running them on a database that already has some
 *       of them) is safe.
 *
 * Runs from the repository (SQL in prisma/sql/) or from the deployment
 * package (SQL in database/sql/, `pg` taken from app/node_modules).
 *
 * The connection string must be supplied explicitly, so there is no way to run
 * this against the wrong database by leaving a file lying around:
 *
 *   DATABASE_URL="postgresql://..." node scripts/production-migration.mjs check
 *
 * Take a Neon branch or backup before applying. Nothing here can restore data,
 * because nothing here removes any.
 */
import { existsSync, readFileSync } from "fs";
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

if (!["check", "apply"].includes(mode)) {
  console.error("Usage: node scripts/production-migration.mjs [check|apply]");
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

async function main() {
  await client.connect();
  const q = async (sql, p) => (await client.query(sql, p ?? [])).rows;
  console.log(`\ntarget: host=${shortHost} db=${target.db} user=${target.user}`);

  if (mode === "check") {
    await client.query("BEGIN TRANSACTION READ ONLY");
    console.log("mode:   CHECK (read-only transaction — the server rejects any write)");
    const missing = await report(q);
    await client.query("ROLLBACK");
    console.log(missing === 0
      ? "\nRESULT: the database already has everything this release needs."
      : `\nRESULT: ${missing} required object(s) missing — run "apply" before deploying.`);
    await client.end();
    process.exit(0);
  }

  // apply
  console.log("mode:   APPLY");
  if (!SQL_DIR) throw new Error("migration SQL folder not found (expected sql/ next to this script, or prisma/sql/)");
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
  await client.end();
  console.log(missing === 0
    ? "\nRESULT: migration applied and verified. The code can now be deployed."
    : `\nRESULT: ${missing} object(s) still missing — do NOT deploy; investigate first.`);
  process.exit(missing === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("\nFAILED:", err.message);
  console.error("Each migration file runs in its own transaction: files reported \"done\" are applied,");
  console.error("the failing file changed nothing, and later files were not run. Re-running is safe.");
  try { await client.end(); } catch {}
  process.exit(1);
});
