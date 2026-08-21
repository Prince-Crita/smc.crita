/**
 * verify-restore — prove a pg_restore landed the data intact.
 *
 * WHY THIS EXISTS
 * ---------------
 * "pg_restore finished without errors" is NOT the same as "the data is all
 * there and correct". A restore can succeed while silently skipping a
 * constraint, leaving a sequence behind the data, or dropping rows a foreign
 * key rejected. This compares SOURCE and TARGET directly and refuses to say
 * "OK" unless they match.
 *
 * It only ever READS. It never writes to either database, and it runs both
 * connections inside a read-only transaction so the server itself enforces
 * that.
 *
 * USAGE (PowerShell)
 *   node scripts/verify-restore.mjs --source "postgresql://..." --target "postgresql://..."
 *
 * Exit code 0 = everything matched. Non-zero = do NOT switch traffic.
 */
import pg from "pg";

// `timestamp without time zone` (oid 1114) is parsed by node-postgres in LOCAL
// time while the application stores UTC. Both sides are read the same way here,
// so comparison is unaffected — but fingerprints are computed in SQL anyway.
pg.types.setTypeParser(1114, (s) => new Date(s + "Z"));

const argv = process.argv.slice(2);
const argOf = (n) => { const i = argv.indexOf(n); return i !== -1 ? argv[i + 1] : undefined; };
const SOURCE = argOf("--source") ?? process.env.SOURCE_URL;
const TARGET = argOf("--target") ?? process.env.TARGET_URL;

if (!SOURCE || !TARGET) {
  console.error("\nusage: node scripts/verify-restore.mjs --source <url> --target <url>\n");
  process.exit(2);
}

const isLocal = (u) => { try { return ["localhost", "127.0.0.1", "::1"].includes(new URL(u).hostname); } catch { return false; } };
const label = (u) => { try { const x = new URL(u); return `${x.hostname}/${x.pathname.slice(1).split("?")[0]}`; } catch { return "?"; } };

async function connect(url) {
  const c = new pg.Client({ connectionString: url, ssl: isLocal(url) ? false : { rejectUnauthorized: false } });
  await c.connect();
  // Server-enforced: any write on this connection is rejected outright.
  await c.query("BEGIN TRANSACTION READ ONLY");
  return c;
}
const rows = async (c, sql, p) => (await c.query(sql, p ?? [])).rows;

let pass = 0, fail = 0;
const ok = (cond, msg, extra = "") => {
  if (cond) { pass++; console.log(`  \x1b[32mOK  \x1b[0m ${msg}${extra ? "  " + extra : ""}`); }
  else { fail++; console.log(`  \x1b[31mFAIL\x1b[0m ${msg}${extra ? "  " + extra : ""}`); }
};
const section = (s) => console.log(`\n\x1b[1m${s}\x1b[0m`);

const src = await connect(SOURCE);
const tgt = await connect(TARGET);

console.log("\n" + "═".repeat(74));
console.log(" RESTORE VERIFICATION");
console.log("═".repeat(74));
console.log(`  source : ${label(SOURCE)}`);
console.log(`  target : ${label(TARGET)}`);
console.log(`  mode   : READ ONLY on both connections (server-enforced)`);

// ── server versions ────────────────────────────────────────────────────────
section("0. Server versions");
const sv = (await rows(src, "show server_version"))[0].server_version;
const tv = (await rows(tgt, "show server_version"))[0].server_version;
console.log(`  source PostgreSQL ${sv}`);
console.log(`  target PostgreSQL ${tv}`);
ok(sv.split(".")[0] === tv.split(".")[0], "same PostgreSQL MAJOR version",
   `(${sv.split(".")[0]} vs ${tv.split(".")[0]})`);

// ── 1. tables and row counts ───────────────────────────────────────────────
section("1. Tables and row counts — every row accounted for");
const tableList = async (c) =>
  (await rows(c, `select table_name from information_schema.tables
                  where table_schema='public' and table_type='BASE TABLE' order by table_name`))
    .map((r) => r.table_name);
const sTables = await tableList(src);
const tTables = await tableList(tgt);
ok(JSON.stringify(sTables) === JSON.stringify(tTables), `same ${sTables.length} tables`,
   sTables.length === tTables.length ? "" : `source ${sTables.length}, target ${tTables.length}`);
const missing = sTables.filter((t) => !tTables.includes(t));
const extra = tTables.filter((t) => !sTables.includes(t));
if (missing.length) console.log(`       missing in target: ${missing.join(", ")}`);
if (extra.length) console.log(`       extra in target  : ${extra.join(", ")}`);

const countOf = async (c, t) => Number((await rows(c, `select count(*)::bigint n from "${t}"`))[0].n);
console.log("");
console.log(`       ${"table".padEnd(24)} ${"source".padStart(8)} ${"target".padStart(8)}   diff`);
let rowMismatch = 0, totalRows = 0;
for (const t of sTables) {
  if (!tTables.includes(t)) continue;
  const a = await countOf(src, t), b = await countOf(tgt, t);
  totalRows += a;
  const same = a === b;
  if (!same) rowMismatch++;
  console.log(`  ${same ? "\x1b[32mOK  \x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${t.padEnd(24)} ${String(a).padStart(8)} ${String(b).padStart(8)}   ${same ? "—" : b - a}`);
}
ok(rowMismatch === 0, `row counts identical across all tables`, `(${totalRows} rows total)`);

// ── 2. content fingerprints ────────────────────────────────────────────────
// Counting rows proves nothing was lost. This proves nothing was CHANGED:
// every column of every row is hashed, order-independently.
section("2. Content fingerprints — no row silently altered");
async function fingerprint(c, table) {
  const cols = (await rows(c,
    `select column_name from information_schema.columns
     where table_schema='public' and table_name=$1 order by ordinal_position`, [table]))
    .map((r) => `coalesce("${r.column_name}"::text,'~N')`);
  if (cols.length === 0) return "∅";
  const sql = `select md5(coalesce(string_agg(h,'' order by h),'')) fp
               from (select md5(concat_ws('|',${cols.join(",")})) h from "${table}") s`;
  return String((await rows(c, sql))[0].fp);
}
let fpMismatch = 0;
for (const t of sTables) {
  if (!tTables.includes(t)) continue;
  const a = await fingerprint(src, t), b = await fingerprint(tgt, t);
  const same = a === b;
  if (!same) fpMismatch++;
  console.log(`  ${same ? "\x1b[32mOK  \x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${t.padEnd(24)} ${same ? a.slice(0, 16) + "…" : `source ${a.slice(0, 12)}… target ${b.slice(0, 12)}…`}`);
}
ok(fpMismatch === 0, "every table byte-for-byte identical");

// ── 3. schema objects ──────────────────────────────────────────────────────
section("3. Schema objects — enums, indexes, constraints, sequences");

const enums = async (c) => rows(c,
  `select t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder) labels
   from pg_type t join pg_enum e on e.enumtypid=t.oid
   join pg_namespace n on n.oid=t.typnamespace where n.nspname='public'
   group by t.typname order by t.typname`);
const se = await enums(src), te = await enums(tgt);
ok(JSON.stringify(se) === JSON.stringify(te), `${se.length} enum types with identical labels`);
for (const e of se) {
  const m = te.find((x) => x.typname === e.typname);
  if (!m || m.labels !== e.labels) console.log(`       \x1b[31m${e.typname}\x1b[0m source=[${e.labels}] target=[${m?.labels ?? "MISSING"}]`);
}

const indexes = async (c) => (await rows(c,
  `select indexname, regexp_replace(indexdef,'\\s+',' ','g') def from pg_indexes
   where schemaname='public' order by indexname`)).map((r) => `${r.indexname}::${r.def}`);
const si = await indexes(src), ti = await indexes(tgt);
ok(JSON.stringify(si) === JSON.stringify(ti), `${si.length} indexes identical`,
   si.length === ti.length ? "" : `source ${si.length}, target ${ti.length}`);
for (const x of si.filter((x) => !ti.includes(x))) console.log(`       missing in target: ${x.split("::")[0]}`);

const constraints = async (c, type) => (await rows(c,
  `select con.conname, rel.relname from pg_constraint con
   join pg_class rel on rel.oid=con.conrelid
   join pg_namespace n on n.oid=rel.relnamespace
   where n.nspname='public' and con.contype=$1 order by rel.relname, con.conname`, [type]))
  .map((r) => `${r.relname}.${r.conname}`);
for (const [t, name] of [["p", "primary keys"], ["f", "foreign keys"], ["u", "unique constraints"], ["c", "check constraints"]]) {
  const a = await constraints(src, t), b = await constraints(tgt, t);
  ok(JSON.stringify(a) === JSON.stringify(b), `${a.length} ${name} identical`,
     a.length === b.length ? "" : `source ${a.length}, target ${b.length}`);
  for (const x of a.filter((x) => !b.includes(x))) console.log(`       missing in target: ${x}`);
}

// Sequences must not be BEHIND the data, or the next insert collides.
const seqs = async (c) => rows(c,
  `select sequencename, last_value from pg_sequences where schemaname='public' order by sequencename`);
const ss = await seqs(src), ts = await seqs(tgt);
if (ss.length === 0) {
  ok(ts.length === 0, "no sequences on either side (ids are cuid/uuid strings, not serials)");
} else {
  ok(JSON.stringify(ss) === JSON.stringify(ts), `${ss.length} sequences at the same value`);
  for (const s of ss) {
    const m = ts.find((x) => x.sequencename === s.sequencename);
    if (!m || String(m.last_value) !== String(s.last_value))
      console.log(`       \x1b[31m${s.sequencename}\x1b[0m source=${s.last_value} target=${m?.last_value ?? "MISSING"}`);
  }
}

// ── 4. referential integrity on the target ─────────────────────────────────
section("4. Referential integrity in the restored database — no orphans");
const orphanChecks = [
  ["tasks without a visit", `select count(*)::int n from tasks t left join visits v on v.id=t."visitId" where v.id is null`],
  ["subtasks without a task", `select count(*)::int n from subtasks s left join tasks t on t.id=s."taskId" where t.id is null`],
  ["visits without a client", `select count(*)::int n from visits v left join clients c on c.id=v."clientId" where c.id is null`],
  ["visits without an executive", `select count(*)::int n from visits v left join users u on u.id=v."executiveId" where u.id is null`],
  ["assignments without a visit", `select count(*)::int n from visit_assignments a left join visits v on v.id=a."visitId" where v.id is null`],
  ["assignments without an executive", `select count(*)::int n from visit_assignments a left join users u on u.id=a."executiveId" where u.id is null`],
  ["attendance without an executive", `select count(*)::int n from attendance a left join users u on u.id=a."executiveId" where u.id is null`],
  ["leave without an executive", `select count(*)::int n from leave_requests l left join users u on u.id=l."executiveId" where u.id is null`],
  ["activity logs without a user", `select count(*)::int n from activity_logs a left join users u on u.id=a."userId" where u.id is null`],
  ["templates without a client", `select count(*)::int n from subtask_templates s left join clients c on c.id=s."clientId" where s."clientId" is not null and c.id is null`],
  ["task types without a client", `select count(*)::int n from client_task_types t left join clients c on c.id=t."clientId" where c.id is null`],
  ["carry-forward pointing nowhere", `select count(*)::int n from subtasks s left join subtasks o on o.id=s."sourceSubtaskId" where s."sourceSubtaskId" is not null and o.id is null`],
];
for (const [name, sql] of orphanChecks) {
  try {
    const n = Number((await rows(tgt, sql))[0].n);
    ok(n === 0, name.padEnd(38) + ` ${n}`);
  } catch (e) {
    ok(false, name.padEnd(38) + ` query failed: ${e.message.split("\n")[0]}`);
  }
}

// ── 5. business spot-checks ────────────────────────────────────────────────
section("5. Business data spot-checks — the numbers people will look at");
const business = [
  ["completed subtasks", `select count(*)::int n from subtasks where "isCompleted"`],
  ["carried-forward subtasks", `select count(*)::int n from subtasks where "isCarriedForward"`],
  ["pending carry-forward requests", `select count(*)::int n from subtasks where "carryForwardRequestedAt" is not null and "carryForwardApprovedAt" is null and "carryForwardRejectedAt" is null`],
  ["CLOSED visits", `select count(*)::int n from visits where status='CLOSED'`],
  ["OPEN visits", `select count(*)::int n from visits where status='OPEN'`],
  ["PENDING visits", `select count(*)::int n from visits where status='PENDING'`],
  ["TEAM visits", `select count(*)::int n from visits where "visitType"='TEAM'`],
  ["active executives", `select count(*)::int n from users where role='EXECUTIVE' and "isActive"`],
  ["attendance rows", `select count(*)::int n from attendance`],
  ["approved leave", `select count(*)::int n from leave_requests where status='APPROVED'`],
  ["visit assignments", `select count(*)::int n from visit_assignments`],
  ["total visit progress points", `select coalesce(sum(case when "isCompleted" then 1 else 0 end),0)::int n from subtasks`],
];
for (const [name, sql] of business) {
  try {
    const a = Number((await rows(src, sql))[0].n), b = Number((await rows(tgt, sql))[0].n);
    ok(a === b, name.padEnd(32) + ` source ${String(a).padStart(6)}   target ${String(b).padStart(6)}`);
  } catch (e) {
    ok(false, name.padEnd(32) + ` query failed: ${e.message.split("\n")[0]}`);
  }
}

await src.query("ROLLBACK"); await src.end();
await tgt.query("ROLLBACK"); await tgt.end();

console.log("\n" + "═".repeat(74));
console.log(fail === 0
  ? `\x1b[32m ALL CHECKS PASSED\x1b[0m — ${pass} checks. The restore is faithful.`
  : `\x1b[31m ${fail} CHECK(S) FAILED\x1b[0m — ${pass} passed. DO NOT switch traffic.`);
console.log("═".repeat(74) + "\n");
process.exit(fail ? 1 : 0);
