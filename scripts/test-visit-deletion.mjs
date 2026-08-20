/**
 * Regression test — Admin → Delete Visit.
 *
 * Guards the one rule that makes this feature safe: deleting a visit removes
 * exactly that occurrence and its own dependent rows, and touches nothing
 * else — not the client, not the client's other visits, not the task
 * configuration, not the subtask templates, not another executive's work.
 *
 * It drives the real HTTP API (so authorisation is exercised too), creates
 * its own fixture data under the ZZTEST_ prefix, and deletes every row it
 * created before exiting — including on failure.
 *
 * Usage:
 *   1. npm run dev                     (a dev server must be listening)
 *   2. node scripts/test-visit-deletion.mjs
 *
 * Safety: it reads DATABASE_URL from .env.development.local and REFUSES to
 * run against anything that is not localhost, so it can never be pointed at
 * the production database.
 */
import { config } from "dotenv";
import { SignJWT } from "jose";
import pg from "pg";

config({ path: ".env.development.local", quiet: true });
config({ path: ".env.local", quiet: true }); // JWT_SECRET only — DATABASE_URL is already set above

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL || !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(DB_URL)) {
  console.error("Refusing to run: DATABASE_URL is not a localhost database.");
  console.error("This test writes and deletes rows and must only ever touch local development data.");
  process.exit(2);
}

const BASE = process.env.TEST_BASE_URL || "http://localhost:3000";
const P = "ZZTEST_";
const pool = new pg.Pool({ connectionString: DB_URL, ssl: false });
const q = async (sql, params) => (await pool.query(sql, params ?? [])).rows;
const secret = new TextEncoder().encode(process.env.JWT_SECRET);

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log("  PASS", msg); } else { fail++; console.log("  FAIL", msg); } };
const eq = (got, want, msg) => ok(JSON.stringify(got) === JSON.stringify(want), `${msg}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

const newId = () => "zzt_" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);

async function sessionFor(role) {
  const [u] = await q(`select id,email,name,role from users where role=$1 and "isActive" order by name limit 1`, [role]);
  if (!u) throw new Error(`No active ${role} user in the local database`);
  const token = await new SignJWT({ userId: u.id, email: u.email, name: u.name, role: u.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);
  return { user: u, token };
}

const deleteVisit = (id, token, query = "") =>
  fetch(`${BASE}/api/admin/visits/${id}${query}`, { method: "DELETE", headers: { cookie: `smc_token=${token}` } })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

async function cleanup() {
  const visitIds = (
    await q(`select id from visits where "visitNumber" like $1 or "clientId" in (select id from clients where code like $1)`, [P + "%"])
  ).map((r) => r.id);
  if (visitIds.length) {
    const taskIds = (await q(`select id from tasks where "visitId" = any($1)`, [visitIds])).map((r) => r.id);
    if (taskIds.length) {
      const subtaskIds = (await q(`select id from subtasks where "taskId" = any($1)`, [taskIds])).map((r) => r.id);
      if (subtaskIds.length) {
        await q(`update subtasks set "sourceSubtaskId"=null where "sourceSubtaskId" = any($1)`, [subtaskIds]);
      }
    }
    await q(`delete from activity_logs where "visitId" = any($1)`, [visitIds]);
    await q(`delete from visit_reassignments where "visitId" = any($1)`, [visitIds]);
    await q(`delete from visit_delegations where "visitId" = any($1)`, [visitIds]);
    await q(`delete from visits where id = any($1)`, [visitIds]);
  }
  await q(`delete from activity_logs where metadata::text like $1`, ["%" + P + "%"]);
  await q(`delete from admin_operations where summary like $1`, ["%" + P + "%"]);
  await q(`delete from subtask_templates where "clientId" in (select id from clients where code like $1)`, [P + "%"]);
  await q(`delete from client_task_types where "clientId" in (select id from clients where code like $1)`, [P + "%"]);
  await q(`delete from clients where code like $1`, [P + "%"]);
}

/** Row counts for everything OUTSIDE the fixture client — must not move. */
async function snapshotRest(excludeClientId) {
  const one = async (sql, params) => (await q(sql, params))[0].c;
  return {
    clients: await one(`select count(*)::int c from clients`),
    visits: await one(`select count(*)::int c from visits where "clientId" <> $1`, [excludeClientId]),
    tasks: await one(`select count(*)::int c from tasks where "visitId" in (select id from visits where "clientId" <> $1)`, [excludeClientId]),
    subtasks: await one(
      `select count(*)::int c from subtasks where "taskId" in (select id from tasks where "visitId" in (select id from visits where "clientId" <> $1))`,
      [excludeClientId]
    ),
    templates: await one(`select count(*)::int c from subtask_templates`),
    taskTypes: await one(`select count(*)::int c from client_task_types`),
    users: await one(`select count(*)::int c from users`),
    attendance: await one(`select count(*)::int c from attendance`),
    leaves: await one(`select count(*)::int c from leave_requests`),
  };
}

async function main() {
  await cleanup();

  const admin = await sessionFor("ADMIN");
  const exec = await sessionFor("EXECUTIVE");
  const execs = await q(`select id,name from users where role='EXECUTIVE' and "isActive" order by name limit 3`);
  if (execs.length < 3) throw new Error("Need at least 3 active executives in the local database");
  const [e1, e2, e3] = execs;

  // ── Fixture: one client, four visits on different dates ─────────────────
  const clientId = newId();
  await q(
    `insert into clients (id,name,code,"contactPerson",address,"assignedExecId","reportEmails","createdAt","updatedAt")
     values ($1,$2,$3,'Test Contact','Test Address',$4,'{}',now(),now())`,
    [clientId, P + "ABC Company", P + "C1", e1.id]
  );
  await q(
    `insert into client_task_types (id,"clientId","taskType",title,"orderIndex","isDeleted","createdAt","updatedAt")
     values ($1,$2,'STOCK_VERIFICATION','Stock Check',1,false,now(),now())`,
    [newId(), clientId]
  );
  for (const [i, t] of ["Template A", "Template B"].entries()) {
    await q(
      `insert into subtask_templates (id,"taskType",title,"orderIndex","isActive","clientId","createdAt","updatedAt")
       values ($1,'STOCK_VERIFICATION',$2,$3,true,$4,now(),now())`,
      [newId(), P + t, i, clientId]
    );
  }

  const makeVisit = async (number, dateISO, status, executiveId, visitType) => {
    const visitId = newId();
    await q(
      `insert into visits (id,"visitNumber","clientId","executiveId",status,"visitType","scheduledDate","createdAt","updatedAt")
       values ($1,$2,$3,$4,$5::"VisitStatus",$6::"VisitType",$7,now(),now())`,
      [visitId, P + number, clientId, executiveId, status, visitType, dateISO]
    );
    const taskId = newId();
    await q(
      `insert into tasks (id,"visitId","taskType",title,status,"orderIndex","createdAt","updatedAt")
       values ($1,$2,'STOCK_VERIFICATION','Stock Verification','PENDING'::"TaskStatus",0,now(),now())`,
      [taskId, visitId]
    );
    const subtaskIds = [];
    for (const s of ["S1", "S2"]) {
      const subtaskId = newId();
      await q(
        `insert into subtasks (id,"taskId",title,"isCompleted","isCarriedForward","createdAt","updatedAt")
         values ($1,$2,$3,false,false,now(),now())`,
        [subtaskId, taskId, P + number + "_" + s]
      );
      subtaskIds.push(subtaskId);
    }
    return { visitId, taskId, subtaskIds };
  };

  const A = await makeVisit("VA", "2026-08-20T04:00:00Z", "OPEN", e1.id, "SOLO");
  const B = await makeVisit("VB", "2026-08-27T04:00:00Z", "PENDING", e1.id, "TEAM");
  const C = await makeVisit("VC", "2026-09-03T04:00:00Z", "PENDING", e2.id, "SOLO");
  const D = await makeVisit("VD", "2026-07-15T04:00:00Z", "CLOSED", e1.id, "SOLO");

  // Team rows on B: lead + two members.
  for (const [execId, role] of [[e1.id, "LEAD"], [e2.id, "MEMBER"], [e3.id, "MEMBER"]]) {
    await q(`insert into visit_assignments (id,"visitId","executiveId",role,"createdAt") values ($1,$2,$3,$4::"VisitRole",now())`,
      [newId(), B.visitId, execId, role]);
  }
  // Carry-forward provenance in BOTH directions across A.
  await q(`update subtasks set "isCarriedForward"=true, "sourceSubtaskId"=$1 where id=$2`, [A.subtaskIds[0], C.subtaskIds[0]]);
  await q(`update subtasks set "isCarriedForward"=true, "sourceSubtaskId"=$1 where id=$2`, [D.subtaskIds[0], A.subtaskIds[1]]);
  await q(`update subtasks set "isCompleted"=true, "completedAt"=now() where id=$1`, [B.subtaskIds[0]]);

  // Visit-specific dependents on A (and one on B that must survive).
  await q(`insert into activity_logs (id,"visitId","userId",action,metadata,"createdAt") values ($1,$2,$3,'VISIT_OPENED'::"ActivityAction",$4,now())`,
    [newId(), A.visitId, admin.user.id, JSON.stringify({ tag: P })]);
  await q(`insert into activity_logs (id,"visitId","userId",action,metadata,"createdAt") values ($1,$2,$3,'VISIT_CREATED'::"ActivityAction",$4,now())`,
    [newId(), B.visitId, admin.user.id, JSON.stringify({ tag: P })]);
  await q(`insert into visit_reassignments (id,"visitId","fromExecutiveId","toExecutiveId",reason,"reassignedById","createdAt") values ($1,$2,$3,$4,$5,$6,now())`,
    [newId(), A.visitId, e1.id, e2.id, P + "reason", admin.user.id]);
  await q(`insert into visit_delegations (id,"visitId","fromExecutiveId","toExecutiveId",status,"leaveDate","leaveReason","createdAt","updatedAt")
           values ($1,$2,$3,$4,'PENDING'::"DelegationStatus",now(),$5,now(),now())`,
    [newId(), A.visitId, e1.id, e2.id, P + "leave"]);

  const before = await snapshotRest(clientId);

  console.log("\nAuthorisation");
  eq((await deleteVisit(A.visitId, exec.token)).status, 403, "an executive's session is rejected with 403");
  ok((await q(`select 1 from visits where id=$1`, [A.visitId])).length === 1, "the visit is untouched after the executive's attempt");
  const anonymous = await fetch(`${BASE}/api/admin/visits/${A.visitId}`, { method: "DELETE", redirect: "manual" });
  ok(anonymous.status !== 200, `an unauthenticated request is refused (${anonymous.status})`);
  ok((await q(`select 1 from visits where id=$1`, [A.visitId])).length === 1, "the visit is untouched after the anonymous attempt");

  console.log("\nClosed-visit guard");
  eq((await deleteVisit(D.visitId, admin.token)).status, 409, "a closed visit is refused without the explicit opt-in");
  ok((await q(`select 1 from visits where id=$1`, [D.visitId])).length === 1, "the closed visit still exists");

  console.log("\nDeleting ONE occurrence");
  const res = await deleteVisit(A.visitId, admin.token, "?allowClosed=1");
  eq(res.status, 200, "admin delete succeeds");
  eq(res.body.removed,
    { tasks: 1, subtasks: 2, assignments: 0, activityLogs: 1, reassignments: 1, delegations: 1, carryForwardLinksCleared: 1 },
    "the reported removal counts match exactly what belonged to the visit");

  console.log("\nEverything else survives");
  ok((await q(`select 1 from visits where id=$1`, [A.visitId])).length === 0, "the selected visit is gone");
  ok((await q(`select 1 from visits where id=$1`, [B.visitId])).length === 1, "the client's 27 Aug visit remains");
  ok((await q(`select 1 from visits where id=$1`, [C.visitId])).length === 1, "the client's 03 Sep visit remains");
  ok((await q(`select 1 from clients where id=$1`, [clientId])).length === 1, "the client remains");
  eq((await q(`select count(*)::int c from client_task_types where "clientId"=$1`, [clientId]))[0].c, 1, "the task configuration remains");
  eq((await q(`select count(*)::int c from subtask_templates where "clientId"=$1`, [clientId]))[0].c, 2, "the subtask templates remain");
  eq((await q(`select count(*)::int c from subtasks where "taskId"=$1`, [B.taskId]))[0].c, 2, "another visit keeps its subtasks");
  ok((await q(`select "isCompleted" from subtasks where id=$1`, [B.subtaskIds[0]]))[0].isCompleted === true, "another visit keeps its progress");

  const carried = (await q(`select "isCarriedForward","sourceSubtaskId" from subtasks where id=$1`, [C.subtaskIds[0]]))[0];
  ok(!!carried, "a carried copy living in another visit still exists");
  ok(carried.sourceSubtaskId === null, "its dangling provenance pointer was cleared to NULL");
  ok(carried.isCarriedForward === true, "its carried-forward flag and content are unchanged");

  console.log("\nNo orphans anywhere in the database");
  const orphans = await q(
    `select 'task' k, count(*)::int c from tasks t left join visits v on v.id=t."visitId" where v.id is null
     union all select 'subtask', count(*)::int from subtasks s left join tasks t on t.id=s."taskId" where t.id is null
     union all select 'assignment', count(*)::int from visit_assignments a left join visits v on v.id=a."visitId" where v.id is null
     union all select 'activity_log', count(*)::int from activity_logs l left join visits v on v.id=l."visitId" where l."visitId" is not null and v.id is null
     union all select 'reassignment', count(*)::int from visit_reassignments r left join visits v on v.id=r."visitId" where v.id is null
     union all select 'delegation', count(*)::int from visit_delegations d left join visits v on v.id=d."visitId" where v.id is null
     union all select 'carry_forward_pointer', count(*)::int from subtasks s left join subtasks p on p.id=s."sourceSubtaskId" where s."sourceSubtaskId" is not null and p.id is null`
  );
  eq(orphans.filter((o) => o.c > 0), [], "zero orphan or dangling rows");
  eq(await snapshotRest(clientId), before, "no row count changed outside the fixture client");

  console.log("\nTeam visits");
  eq((await q(`select count(*)::int c from visit_assignments where "visitId"=$1`, [B.visitId]))[0].c, 3, "the team visit has three members");
  const teamResult = await deleteVisit(B.visitId, admin.token);
  eq(teamResult.status, 200, "the team visit deletes");
  eq(teamResult.body.removed.assignments, 3, "all three team rows are removed together");
  eq(teamResult.body.affectedExecutiveIds.length, 3, "the lead and both members are reported as affected");
  ok((await q(`select 1 from visits where id=$1`, [C.visitId])).length === 1, "another executive's visit is untouched");

  console.log("\nEdge cases");
  eq((await deleteVisit(D.visitId, admin.token, "?allowClosed=1")).status, 200, "a closed visit deletes with the explicit opt-in");
  eq((await deleteVisit("no-such-visit-id", admin.token)).status, 404, "an unknown id returns 404");

  console.log("\nThe deleted visits are absent from every read API");
  const gone = [A.visitId, B.visitId, D.visitId];
  const reads = [
    ["admin calendar (week of A)", "/api/calendar?week=2026-08-20", admin.token],
    ["admin calendar (week of B)", "/api/calendar?week=2026-08-27", admin.token],
    ["admin visit list", "/api/admin/visits", admin.token],
    ["admin dashboard stats", "/api/admin/stats", admin.token],
    ["admin client history", `/api/admin/clients/${clientId}`, admin.token],
    ["admin carry-forward", "/api/admin/carry-forward", admin.token],
    ["admin carry-forward requests", "/api/admin/carry-forward/requests", admin.token],
    ["executive visit list", "/api/visits", exec.token],
    ["executive calendar", "/api/calendar?week=2026-08-20", exec.token],
    ["executive carry-forward", "/api/carry-forward", exec.token],
  ];
  for (const [label, path, token] of reads) {
    const body = await fetch(BASE + path, { headers: { cookie: `smc_token=${token}` } }).then((r) => r.text());
    ok(!gone.some((v) => body.includes(v)), `${label} no longer mentions any deleted visit`);
  }
  eq((await fetch(`${BASE}/api/visits/${A.visitId}`, { headers: { cookie: `smc_token=${admin.token}` } })).status, 404,
    "the deleted visit's detail endpoint returns 404");

  console.log("\nList endpoints stay lean");
  // The admin/executive lists must not ship a per-subtask array per visit —
  // that is what made them multi-megabyte before the aggregate rewrite.
  for (const [label, path, token] of [
    ["admin visit list", "/api/admin/visits", admin.token],
    ["executive visit list", "/api/visits", exec.token],
  ]) {
    const json = await fetch(BASE + path, { headers: { cookie: `smc_token=${token}` } }).then((r) => r.json());
    const first = (json.visits ?? [])[0];
    ok(!first || first.tasks === undefined, `${label} does not ship the tasks/subtasks tree`);
    ok(!first || typeof first.totalSubtasks === "number", `${label} still reports subtask totals`);
  }

  await cleanup();
  const residue = await q(
    `select 'clients' t, count(*)::int c from clients where code like $1 or name like $1
     union all select 'visits', count(*)::int from visits where "visitNumber" like $1
     union all select 'subtasks', count(*)::int from subtasks where title like $1
     union all select 'templates', count(*)::int from subtask_templates where title like $1
     union all select 'activity_logs', count(*)::int from activity_logs where metadata::text like $2
     union all select 'admin_operations', count(*)::int from admin_operations where summary like $2`,
    [P + "%", "%" + P + "%"]
  );
  eq(residue.filter((r) => r.c > 0), [], "the test left no data behind");

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  await pool.end();
  process.exit(fail ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await cleanup().catch(() => {});
  await pool.end();
  process.exit(1);
});
