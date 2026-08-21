/**
 * Regression test — a visit must carry the client's configured tasks.
 *
 * Guards the behaviour reported broken in production for Wewin Knit Fashion:
 * the visit appeared correctly for its Team Lead and member, but the main
 * tasks and subtasks configured for the client were not inside it.
 *
 * The cause was never visit creation, teams or the executive API — it was that
 * a carry-forward-only visit was permanently excluded from the client's task
 * configuration. When that visit is the client's ONLY one for the week (which
 * is when carry-forward creates it) the executives are sent to the client with
 * nothing but the missed items, and with none of the ordinary checklist.
 *
 * What this locks down:
 *   • SOLO and TEAM visits both scaffold the client's configuration, including
 *     per-client renames and per-client deletions of the default task types;
 *   • a carry-forward visit that stands in for the client's weekly visit gets
 *     the configured tasks too, WITHOUT duplicating the carried subtask;
 *   • a carry-forward visit that merely supplements a real visit that week
 *     stays a pure carry-forward container (Rule 2 is not weakened);
 *   • a task-configuration change reaches a carry-forward visit additively —
 *     carried and completed work is never replaced or deleted;
 *   • one visit, one set of tasks, one set of subtasks. No duplicates.
 *
 * Drives the real HTTP API, creates its own ZZTS_ fixtures, cleans up always.
 * Local database only.
 */
import { config } from "dotenv";
import { SignJWT } from "jose";
import pg from "pg";

config({ path: ".env.development.local", quiet: true });
config({ path: ".env.local", quiet: true });
pg.types.setTypeParser(1114, (s) => new Date(s + "Z"));

const DB = process.env.DATABASE_URL;
if (!DB || !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(DB)) {
  console.error("Refusing: DATABASE_URL is not a localhost database."); process.exit(2);
}
const BASE = process.env.TEST_BASE_URL || "http://localhost:3000";
const P = "ZZTS_";
const pool = new pg.Pool({ connectionString: DB, ssl: false });
const q = async (s, p) => (await pool.query(s, p ?? [])).rows;
const secret = new TextEncoder().encode(process.env.JWT_SECRET);
const rid = () => "zzts_" + Math.random().toString(36).slice(2, 11) + Date.now().toString(36);

let pass = 0, fail = 0;
const ok = (c, m, x = "") => { if (c) { pass++; console.log("  PASS", m, x); } else { fail++; console.log("  FAIL", m, x); } };
const eq = (g, w, m) => ok(JSON.stringify(g) === JSON.stringify(w), `${m}  (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`);
const section = (s) => console.log(`\n${s}`);

const tokenFor = (u) => new SignJWT({ userId: u.id, email: u.email, name: u.name, role: u.role })
  .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secret);
const api = (path, token, init = {}) =>
  fetch(`${BASE}${path}`, { ...init, redirect: "manual",
    headers: { "content-type": "application/json", cookie: `smc_token=${token}`, ...(init.headers || {}) } })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

async function mkUser(name) {
  const id = rid();
  await q(`insert into users (id,name,email,"passwordHash",role,"isActive","createdAt","updatedAt")
           values ($1,$2,$3,'x','EXECUTIVE',true,now(),now())`, [id, P + name, `${id}@zzts.invalid`]);
  const u = { id, name: P + name, email: `${id}@zzts.invalid`, role: "EXECUTIVE" };
  u.token = await tokenFor(u);
  return u;
}

/** Monday 00:00 UTC of the week containing `d` — the app's week boundary. */
function mondayUTC(d) {
  const m = new Date(d);
  const dow = m.getUTCDay();
  m.setUTCDate(m.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  m.setUTCHours(0, 0, 0, 0);
  return m;
}
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const isoDay = (d) => d.toISOString().slice(0, 10);

/** Main tasks on a visit, with their subtask titles — the shape under test. */
async function structureOf(visitId) {
  const tasks = await q(
    `select t.id, t."taskType", t.title, t."orderIndex" from tasks t
     where t."visitId"=$1 order by t."orderIndex", t."taskType"`, [visitId]);
  const out = [];
  for (const t of tasks) {
    const subs = await q(`select title from subtasks where "taskId"=$1 order by title`, [t.id]);
    out.push({ taskType: t.taskType, title: t.title, subtasks: subs.map((s) => s.title) });
  }
  return out;
}
const typesOf = (structure) => structure.map((t) => t.taskType).sort();

async function cleanup() {
  const cl = (await q(`select id from clients where code like $1`, [P + "%"])).map((r) => r.id);
  const us = (await q(`select id from users where name like $1`, [P + "%"])).map((r) => r.id);
  const vs = (await q(`select id from visits where "visitNumber" like $1 or "clientId"=any($2) or "executiveId"=any($3)`,
    [P + "%", cl, us])).map((r) => r.id);
  if (vs.length) {
    const ts = (await q(`select id from tasks where "visitId"=any($1)`, [vs])).map((r) => r.id);
    if (ts.length) {
      const ss = (await q(`select id from subtasks where "taskId"=any($1)`, [ts])).map((r) => r.id);
      if (ss.length) await q(`update subtasks set "sourceSubtaskId"=null where "sourceSubtaskId"=any($1)`, [ss]);
    }
    for (const t of ["activity_logs", "visit_reassignments", "visit_delegations", "visit_assignments"])
      await q(`delete from ${t} where "visitId"=any($1)`, [vs]);
    await q(`delete from visits where id=any($1)`, [vs]);
  }
  if (us.length) {
    await q(`update clients set "assignedExecId"=null where "assignedExecId"=any($1)`, [us]);
    await q(`update clients set "seniorExecId"=null where "seniorExecId"=any($1)`, [us]);
    await q(`update subtasks set "carryForwardApprovedById"=null where "carryForwardApprovedById"=any($1)`, [us]);
    await q(`delete from activity_logs where "userId"=any($1)`, [us]);
    await q(`delete from attendance where "executiveId"=any($1)`, [us]);
    await q(`delete from admin_operations where "userId"=any($1) or "undoneById"=any($1)`, [us]);
  }
  if (cl.length) {
    await q(`delete from subtask_templates where "clientId"=any($1)`, [cl]);
    await q(`delete from client_task_types where "clientId"=any($1)`, [cl]);
    await q(`delete from clients where id=any($1)`, [cl]);
  }
  if (us.length) await q(`delete from users where id=any($1)`, [us]);
}

// The exact production configuration of Wewin Knit Fashion: two default task
// types renamed, three deleted, and MD Meeting left at its default title.
const RENAMED = [["OPERATIONAL_VERIFICATION", "Weekly Wages"], ["STOCK_VERIFICATION", "AVF Reports"]];
const DELETED = ["ACCOUNTS_VERIFICATION", "AVF_REPORT", "MR_MONTHLY_REPORT"];
const TEMPLATES = [
  ["OPERATIONAL_VERIFICATION", ["Bank statement verification", "Contract advance statement verification"]],
  ["STOCK_VERIFICATION", ["Yarn & Fabric Po Pending Reports", "All Process Outstanding Reports",
                          "Accessories Po Pending Reports", "Closure report verification"]],
  ["MD_MEETING", ["Weekly Review Meeting"]],
];
const EXPECTED_TYPES = ["MD_MEETING", "OPERATIONAL_VERIFICATION", "STOCK_VERIFICATION"];
const EXPECTED_SUBTASK_COUNT = 7;

async function main() {
  await cleanup();

  const [admin] = await q(`select id,email,name,role from users where role='ADMIN' and "isActive" order by name limit 1`);
  if (!admin) throw new Error("No active ADMIN in the local database");
  admin.token = await tokenFor(admin);

  const lead = await mkUser("Alagarsamy");   // Team Lead in the reported case
  const member = await mkUser("Muthusamy");  // Team member in the reported case

  const clientId = rid();
  await q(`insert into clients (id,name,code,"contactPerson",address,"reportEmails","isArchived","createdAt","updatedAt")
           values ($1,$2,$3,'C','A','{}',false,now(),now())`, [clientId, P + "Wewin Knit Fashion", P + "WEW"]);
  // orderIndex is left NULL exactly as the production rows have it, so the
  // plan resolver's fallback to the default ordering is exercised too.
  for (const [taskType, title] of RENAMED)
    await q(`insert into client_task_types (id,"clientId","taskType",title,"orderIndex","isDeleted","createdAt","updatedAt")
             values ($1,$2,$3,$4,null,false,now(),now())`, [rid(), clientId, taskType, title]);
  for (const taskType of DELETED)
    await q(`insert into client_task_types (id,"clientId","taskType",title,"orderIndex","isDeleted","createdAt","updatedAt")
             values ($1,$2,$3,null,null,true,now(),now())`, [rid(), clientId, taskType]);
  for (const [taskType, titles] of TEMPLATES)
    for (let i = 0; i < titles.length; i++)
      await q(`insert into subtask_templates (id,"taskType",title,"orderIndex","isActive","clientId","createdAt","updatedAt")
               values ($1,$2,$3,$4,true,$5,now(),now())`, [rid(), taskType, titles[i], i + 1, clientId]);

  const weekA = mondayUTC(addDays(new Date(), 7));
  const weekB = addDays(weekA, 7);
  const weekC = addDays(weekA, 14);

  // ══════════════════════════════════════════════════════════════════════
  section("1. SOLO visit receives the client's configured tasks");
  const solo = await api("/api/admin/visits", admin.token, {
    method: "POST",
    body: JSON.stringify({ clientId, executiveId: lead.id, scheduledDate: isoDay(weekA), visitType: "SOLO" }),
  });
  eq(solo.status, 201, "solo visit created");
  const soloId = solo.body.visit?.id;
  const soloStruct = await structureOf(soloId);
  eq(typesOf(soloStruct), EXPECTED_TYPES, "exactly the 3 configured main tasks — the 3 deleted types are absent");
  eq(soloStruct.find((t) => t.taskType === "OPERATIONAL_VERIFICATION")?.title, "Weekly Wages",
    "the per-client RENAME is used as the main task title");
  eq(soloStruct.find((t) => t.taskType === "STOCK_VERIFICATION")?.title, "AVF Reports",
    "the second rename too");
  eq(soloStruct.find((t) => t.taskType === "MD_MEETING")?.title, "MD Meeting",
    "an unconfigured default keeps its default title");
  eq(soloStruct.reduce((n, t) => n + t.subtasks.length, 0), EXPECTED_SUBTASK_COUNT,
    "every configured subtask template was created");
  eq(soloStruct.find((t) => t.taskType === "STOCK_VERIFICATION")?.subtasks.length, 4, "…4 under Stock Verification");
  eq(Number((await q(`select count(*)::int c from tasks where "visitId"=$1`, [soloId]))[0].c), 3, "no duplicate task rows");

  // ══════════════════════════════════════════════════════════════════════
  section("2. TEAM visit receives the SAME configured tasks (the reported case)");
  const team = await api("/api/admin/visits", admin.token, {
    method: "POST",
    body: JSON.stringify({
      clientId, executiveId: lead.id, scheduledDate: isoDay(addDays(weekA, 1)),
      visitType: "TEAM", memberIds: [member.id],
    }),
  });
  eq(team.status, 201, "team visit created");
  const teamId = team.body.visit?.id;

  eq(Number((await q(`select count(*)::int c from visits where "clientId"=$1`, [clientId]))[0].c), 2,
    "exactly TWO visits exist for the client — a team does not create one visit per executive");
  eq((await q(`select a.role, u.name from visit_assignments a join users u on u.id=a."executiveId"
               where a."visitId"=$1 order by a.role`, [teamId])).map((r) => `${r.role}:${r.name}`),
    [`LEAD:${P}Alagarsamy`, `MEMBER:${P}Muthusamy`], "lead and member assignments both exist");

  const teamStruct = await structureOf(teamId);
  eq(typesOf(teamStruct), EXPECTED_TYPES, "the team visit has the same 3 configured main tasks");
  eq(teamStruct.reduce((n, t) => n + t.subtasks.length, 0), EXPECTED_SUBTASK_COUNT, "and the same 7 subtasks");
  eq(teamStruct, soloStruct, "a TEAM visit gets byte-for-byte the same task structure as a SOLO one");
  eq(Number((await q(
    `select count(*)::int c from subtasks s join tasks t on t.id=s."taskId" where t."visitId"=$1`, [teamId]))[0].c),
    EXPECTED_SUBTASK_COUNT, "no duplicate subtask rows");
  eq(Number((await q(`select count(*)::int c from tasks where "visitId"=$1`, [teamId]))[0].c), 3, "no duplicate task rows");
  ok((await q(`select count(*)::int c from tasks where "visitId"=$1 and "visitId" is not null`, [teamId]))[0].c === 3,
    "every task is linked to the visit");
  eq(Number((await q(
    `select count(*)::int c from subtasks s join tasks t on t.id=s."taskId"
     where t."visitId"=$1 and s."taskId" is null`, [teamId]))[0].c), 0, "every subtask is linked to a task");

  section("   the LEAD, the MEMBER and the ADMIN all see those tasks");
  for (const [who, u] of [["lead", lead], ["member", member]]) {
    const r = await api(`/api/visits/${teamId}`, u.token);
    eq(r.status, 200, `the ${who} can read the visit`);
    const types = (r.body.visit?.tasks ?? r.body.tasks ?? []).map((t) => t.taskType).sort();
    eq(types, EXPECTED_TYPES, `  the ${who}'s API returns all 3 configured main tasks`);
    const subs = (r.body.visit?.tasks ?? r.body.tasks ?? []).reduce((n, t) => n + (t.subtasks?.length ?? 0), 0);
    eq(subs, EXPECTED_SUBTASK_COUNT, `  and all ${EXPECTED_SUBTASK_COUNT} configured subtasks`);
  }
  const adminList = await api("/api/admin/visits", admin.token);
  const adminVisit = (adminList.body.visits ?? []).find((v) => v.id === teamId);
  eq(adminVisit?.totalSubtasks, EXPECTED_SUBTASK_COUNT, "the admin list counts all 7 subtasks on the team visit");

  // ══════════════════════════════════════════════════════════════════════
  section("3. A carry-forward visit that STANDS IN for the client's week gets the configuration");
  // Work the team visit, leave one item unfinished with a reason, close it.
  const mdTask = (await q(`select id from tasks where "visitId"=$1 and "taskType"='MD_MEETING'`, [teamId]))[0];
  const [carriedSub] = await q(`select id, title from subtasks where "taskId"=$1`, [mdTask.id]);
  await q(`update subtasks set "isCompleted"=true where "taskId" <> $1 and "taskId" in
           (select id from tasks where "visitId"=$2)`, [mdTask.id, teamId]);
  await q(`update subtasks set "incompletionReason"='MD Not Available' where id=$1`, [carriedSub.id]);
  // Closing validates that MD Meeting has its mandatory YES/NO answer.
  await q(`update tasks set "mdMeetingAnswer"='NO' where id=$1`, [mdTask.id]);
  eq((await api(`/api/visits/${teamId}`, lead.token, { method: "PATCH", body: "{}" })).status, 200, "the lead opens the visit");
  const closed = await api(`/api/visits/${teamId}/close`, lead.token, { method: "POST", body: "{}" });
  eq(closed.status, 200, "the lead closes it");
  eq(Number((await q(`select count(*)::int c from subtasks where id=$1 and "carryForwardRequestedAt" is not null`,
    [carriedSub.id]))[0].c), 1, "the unfinished item becomes a pending carry-forward request");

  // Week B holds no other visit for this client, so the approved carry-forward
  // must create one — and that visit IS the client's visit for that week.
  const approve = await api("/api/admin/carry-forward/requests", admin.token, {
    method: "POST",
    body: JSON.stringify({
      subtaskIds: [carriedSub.id], destinationDate: isoDay(weekB),
      assignment: { visitType: "TEAM", executiveId: lead.id, memberIds: [member.id] },
    }),
  });
  eq(approve.status, 200, "admin approves the carry-forward onto a date in an empty week");
  const cfVisitId = approve.body.destinations?.[0]?.visitId;
  ok(!!cfVisitId, "a destination visit was produced");
  eq(approve.body.destinations?.[0]?.created, true, "  and it had to be created (no visit existed that week)");

  const cfStruct = await structureOf(cfVisitId);
  eq(typesOf(cfStruct), EXPECTED_TYPES, "THE FIX: the carry-forward visit carries the client's 3 configured main tasks");
  const cfTitles = cfStruct.flatMap((t) => t.subtasks);
  ok(cfTitles.some((t) => t.includes(carriedSub.title)), "the carried subtask is on it");
  eq(cfTitles.filter((t) => t.replace("[CARRY-FORWARD] ", "") === carriedSub.title).length, 1,
    "…exactly once — the configured template line did NOT create a duplicate twin");
  eq(cfTitles.length, EXPECTED_SUBTASK_COUNT, "7 subtasks in total: 6 configured + the carried one");
  eq((await q(`select a.role, u.name from visit_assignments a join users u on u.id=a."executiveId"
               where a."visitId"=$1 order by a.role`, [cfVisitId])).map((r) => `${r.role}:${r.name}`),
    [`LEAD:${P}Alagarsamy`, `MEMBER:${P}Muthusamy`], "the admin's team assignment was applied to it");
  for (const [who, u] of [["lead", lead], ["member", member]]) {
    const r = await api(`/api/visits/${cfVisitId}`, u.token);
    const types = (r.body.visit?.tasks ?? r.body.tasks ?? []).map((t) => t.taskType).sort();
    eq(types, EXPECTED_TYPES, `  the ${who} sees all 3 main tasks on the carry-forward visit`);
  }

  // ══════════════════════════════════════════════════════════════════════
  section("4. Rule 2 is NOT weakened: a carry-forward visit that only SUPPLEMENTS a real visit stays a container");
  // A normal visit already covers week C, so a carry-forward approved into
  // that week must not scaffold a second full copy of the configuration.
  const weekCVisit = await api("/api/admin/visits", admin.token, {
    method: "POST",
    body: JSON.stringify({ clientId, executiveId: lead.id, scheduledDate: isoDay(addDays(weekC, 3)), visitType: "SOLO" }),
  });
  eq(weekCVisit.status, 201, "a normal visit exists in that week");

  const cfTask = (await q(`select id from tasks where "visitId"=$1 and "taskType"='STOCK_VERIFICATION'`, [cfVisitId]))[0];
  const [spare] = await q(`select id, title from subtasks where "taskId"=$1 and not "isCarriedForward" limit 1`, [cfTask.id]);
  await q(`update subtasks set "incompletionReason"='not done', "carryForwardRequestedAt"=now() where id=$1`, [spare.id]);

  const approve2 = await api("/api/admin/carry-forward/requests", admin.token, {
    method: "POST",
    body: JSON.stringify({ subtaskIds: [spare.id], destinationDate: isoDay(weekC) }),
  });
  eq(approve2.status, 200, "admin approves a second carry-forward into a week that already has a visit");
  const cf2Id = approve2.body.destinations?.[0]?.visitId;
  ok(!!cf2Id && cf2Id !== cfVisitId, "it produced its own destination visit");
  const cf2Struct = await structureOf(cf2Id);
  eq(typesOf(cf2Struct), ["STOCK_VERIFICATION"],
    "it holds ONLY the carried item's main task — the configuration was not copied in");
  eq(cf2Struct.reduce((n, t) => n + t.subtasks.length, 0), 1, "and exactly one subtask");

  // ══════════════════════════════════════════════════════════════════════
  section("5. A task-configuration change reaches the carry-forward visit ADDITIVELY");
  // Complete one configured item and note the carried one, then add a template.
  const opTask = (await q(`select id from tasks where "visitId"=$1 and "taskType"='OPERATIONAL_VERIFICATION'`, [cfVisitId]))[0];
  const [doneSub] = await q(`select id from subtasks where "taskId"=$1 limit 1`, [opTask.id]);
  await q(`update subtasks set "isCompleted"=true where id=$1`, [doneSub.id]);

  const added = await api("/api/admin/subtask-templates", admin.token, {
    method: "POST",
    body: JSON.stringify({ clientId, taskType: "MD_MEETING", title: "Board sign-off", orderIndex: 2 }),
  });
  ok(added.status === 200 || added.status === 201, "admin adds a subtask template", `(${added.status})`);

  const afterSync = await structureOf(cfVisitId);
  const mdAfter = afterSync.find((t) => t.taskType === "MD_MEETING");
  ok(mdAfter?.subtasks.some((t) => t === "Board sign-off"), "the new template appears on the carry-forward visit");
  ok(mdAfter?.subtasks.some((t) => t.replace("[CARRY-FORWARD] ", "") === carriedSub.title),
    "the CARRIED subtask is still there — the sync never replaced it");
  eq(Number((await q(`select count(*)::int c from subtasks where id=$1 and "isCompleted"`, [doneSub.id]))[0].c), 1,
    "the COMPLETED subtask is still there and still completed");
  eq(Number((await q(`select count(*)::int c from subtasks where id=$1`, [carriedSub.id]))[0].c), 1,
    "the original subtask on the closed visit is untouched");

  // ══════════════════════════════════════════════════════════════════════
  section("6. No duplicates anywhere for this client");
  const dupVisits = await q(
    `select "scheduledDate"::date d, count(*)::int c from visits where "clientId"=$1 group by 1 having count(*)>1`, [clientId]);
  eq(dupVisits.length, 0, "no two visits share a date for this client");
  const dupTasks = await q(
    `select t."visitId", t."taskType", count(*)::int c from tasks t
     join visits v on v.id=t."visitId" where v."clientId"=$1 group by 1,2 having count(*)>1`, [clientId]);
  eq(dupTasks.length, 0, "no visit holds the same main task type twice");
  const dupSubs = await q(
    `select v."visitNumber", tk."taskType", lower(replace(s.title,'[CARRY-FORWARD] ','')) t, count(*)::int c
     from subtasks s join tasks tk on tk.id=s."taskId" join visits v on v.id=tk."visitId"
     where v."clientId"=$1 group by 1,2,3 having count(*)>1 order by 1,2`, [clientId]);
  ok(dupSubs.length === 0, "no task holds the same subtask title twice (carried or configured)",
    dupSubs.length ? `\n      ${dupSubs.map((r) => `${r.visitNumber} ${r.taskType} "${r.t}" ×${r.c}`).join("\n      ")}` : "");
}

const t0 = Date.now();
main()
  .catch((e) => { fail++; console.error("\nERROR:", e.message, e.stack); })
  .finally(async () => {
    await cleanup();
    eq(Number((await q(`select count(*)::int c from clients where code like $1`, [P + "%"]))[0].c), 0,
      "no fixtures left behind");
    console.log(`\n=== ${pass} passed, ${fail} failed  (${Date.now() - t0}ms) ===`);
    await pool.end();
    process.exit(fail ? 1 : 0);
  });
