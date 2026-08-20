/**
 * Local database check — "am I on the right database, and is its schema current?"
 *
 * Answers, without printing a single secret:
 *   • which database this project's LOCAL configuration points at
 *   • whether that database is reachable
 *   • whether its schema contains everything the current application expects
 *     (Team Visit, Super Admin, Carry Forward, the performance indexes)
 *   • how much local development data is present
 *
 * It is strictly READ-ONLY: no CREATE, ALTER, INSERT, UPDATE or DELETE.
 * It refuses to connect to anything that is not a localhost database, so it
 * can never be pointed at production.
 *
 * Usage:
 *   node scripts/check-local-db.mjs
 *
 * To see what the RUNNING application is connected to (which can differ, if
 * DATABASE_URL is set in your shell), start the dev server and open:
 *   http://localhost:3000/api/dev/db-target
 */
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.development.local", quiet: true });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set in .env.development.local.");
  console.error("Local development needs that file to point at the local PostgreSQL server.");
  process.exit(2);
}

let parsed;
try {
  parsed = new URL(url);
} catch {
  console.error("DATABASE_URL in .env.development.local is not a valid connection string.");
  process.exit(2);
}

const LOCAL = ["localhost", "127.0.0.1", "::1", "[::1]"];
if (!LOCAL.includes(parsed.hostname)) {
  console.error(`REFUSING TO CONNECT: host is "${parsed.hostname}", which is not local.`);
  console.error("This script only ever talks to the local development database.");
  process.exit(2);
}

const database = parsed.pathname.replace(/^\//, "").split("?")[0];
const pool = new pg.Pool({ connectionString: url, ssl: false });
const q = async (sql, params) => (await pool.query(sql, params ?? [])).rows;

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log("  ok   ", msg); } else { fail++; console.log("  MISSING", msg); } };

const hasColumn = async (table, column) =>
  (await q(`select 1 from information_schema.columns where table_name=$1 and column_name=$2`, [table, column])).length === 1;
const hasTable = async (table) =>
  (await q(`select 1 from information_schema.tables where table_schema='public' and table_name=$1`, [table])).length === 1;
const hasEnum = async (name) => (await q(`select 1 from pg_type where typname=$1`, [name])).length === 1;

async function main() {
  console.log(`\nconfigured : host=${parsed.hostname} port=${parsed.port || "5432"} db=${database} user=${parsed.username}`);
  const [live] = await q(`select current_database() db, inet_server_port() port, current_user usr`);
  console.log(`connected  : db=${live.db} port=${live.port} user=${live.usr}`);
  console.log("production : NOT CONNECTED (host is local)\n");

  console.log("Team Visit");
  ok(await hasColumn("visits", "visitType"), "visits.visitType");
  ok(await hasEnum("VisitType"), 'enum "VisitType"');
  ok(await hasEnum("VisitRole"), 'enum "VisitRole"');
  ok(await hasTable("visit_assignments"), "table visit_assignments");

  console.log("Super Admin");
  ok(await hasTable("admin_operations"), "table admin_operations");
  for (const c of ["beforeJson", "afterJson", "isReversible", "undoneAt", "undoneById"]) {
    ok(await hasColumn("admin_operations", c), `admin_operations.${c}`);
  }
  ok(
    (await q(`select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='Role' and e.enumlabel='SUPER_ADMIN'`)).length === 1,
    'enum "Role" includes SUPER_ADMIN'
  );

  console.log("Carry Forward (admin-approved)");
  for (const c of [
    "isCarriedForward", "sourceSubtaskId",
    "carryForwardRequestedAt", "carryForwardApprovedAt", "carryForwardApprovedById", "carryForwardRejectedAt",
  ]) {
    ok(await hasColumn("subtasks", c), `subtasks.${c}`);
  }
  ok(await hasColumn("visits", "endDate"), "visits.endDate");

  console.log("Other");
  ok(await hasTable("client_task_types"), "table client_task_types");
  ok(await hasTable("visit_delegations"), "table visit_delegations");

  console.log("Performance indexes (prisma/sql/performance-indexes.sql)");
  const indexes = (await q(`select indexname from pg_indexes where schemaname='public'`)).map((r) => r.indexname);
  for (const name of [
    "visits_clientId_idx", "visits_executiveId_idx", "visits_scheduledDate_idx",
    "visits_status_idx", "visits_updatedAt_idx",
    "activity_logs_visitId_idx", "subtasks_isCarriedForward_idx",
  ]) {
    ok(indexes.includes(name), name);
  }

  console.log("\nLocal data");
  const tables = [
    "users", "clients", "visits", "tasks", "subtasks", "visit_assignments",
    "activity_logs", "visit_reassignments", "visit_delegations",
    "subtask_templates", "client_task_types", "admin_operations", "attendance", "leave_requests",
  ];
  for (const t of tables) {
    const [{ c }] = await q(`select count(*)::int c from "${t}"`);
    console.log(`  ${t.padEnd(22)} ${c}`);
  }

  if (fail === 0) {
    console.log(`\nSchema is up to date with the application (${pass} checks passed).`);
  } else {
    console.log(`\n${fail} expected schema object(s) are MISSING — the local database is behind prisma/schema.prisma.`);
    console.log("See exactly what differs (read-only):");
    console.log("  npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script");
    console.log("Then apply it to the LOCAL database only:");
    console.log("  npx prisma db push        # prisma.config.ts defaults to .env.development.local");
  }
  await pool.end();
  process.exit(fail ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
