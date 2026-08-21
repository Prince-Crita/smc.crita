/**
 * Regression test — Admin → Executives → Delete.
 *
 * The rule this guards:
 *   • an executive holding a client, a visit, a team membership or any record
 *     of real work CANNOT be deleted (protection unchanged), and the message
 *     says what actually blocks;
 *   • an executive whose only footprint is signing in and out CAN be deleted,
 *     and their sign-in rows and attendance go with them;
 *   • nothing belonging to anyone else is touched.
 *
 * Local database only. Creates its own ZZED_ fixtures and removes them always.
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
const P = "ZZED_";
const pool = new pg.Pool({ connectionString: DB, ssl: false });
const q = async (s, p) => (await pool.query(s, p ?? [])).rows;
const secret = new TextEncoder().encode(process.env.JWT_SECRET);
const rid = () => "zzed_" + Math.random().toString(36).slice(2, 11) + Date.now().toString(36);

let pass = 0, fail = 0;
const ok = (c, m, x = "") => { if (c) { pass++; console.log("  PASS", m, x); } else { fail++; console.log("  FAIL", m, x); } };
const eq = (g, w, m) => ok(JSON.stringify(g) === JSON.stringify(w), `${m}  (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`);
const section = (s) => console.log(`\n${s}`);

const tokenFor = (u) => new SignJWT({ userId: u.id, email: u.email, name: u.name, role: u.role })
  .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secret);
const del = (id, token) => fetch(`${BASE}/api/admin/executives/${id}`, {
  method: "DELETE", headers: { cookie: `smc_token=${token}` }, redirect: "manual",
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

async function mkExec(name, { active = true } = {}) {
  const id = rid();
  await q(`insert into users (id,name,email,"passwordHash",role,"isActive","createdAt","updatedAt")
           values ($1,$2,$3,'x','EXECUTIVE',$4,now(),now())`, [id, P + name, `${id}@zzed.invalid`, active]);
  return { id, name: P + name, email: `${id}@zzed.invalid`, role: "EXECUTIVE" };
}
const log = (userId, action, visitId = null) =>
  q(`insert into activity_logs (id,"visitId","userId",action,"createdAt") values ($1,$2,$3,$4,now())`,
    [rid(), visitId, userId, action]);

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
    await q(`delete from leave_requests where "executiveId"=any($1) or "reviewedById"=any($1)`, [us]);
    await q(`delete from admin_operations where "userId"=any($1) or "undoneById"=any($1)`, [us]);
  }
  if (cl.length) {
    await q(`delete from subtask_templates where "clientId"=any($1)`, [cl]);
    await q(`delete from client_task_types where "clientId"=any($1)`, [cl]);
    await q(`delete from clients where id=any($1)`, [cl]);
  }
  if (us.length) await q(`delete from users where id=any($1)`, [us]);
}

const exists = async (id) => Number((await q(`select count(*)::int c from users where id=$1`, [id]))[0].c) === 1;
const totals = async () => (await q(`select
  (select count(*)::int from users) users,(select count(*)::int from clients) clients,
  (select count(*)::int from visits) visits,(select count(*)::int from tasks) tasks,
  (select count(*)::int from subtasks) subtasks,(select count(*)::int from attendance) attendance,
  (select count(*)::int from activity_logs) logs`))[0];

async function main() {
  await cleanup();

  const [admin] = await q(`select id,email,name,role from users where role='ADMIN' and "isActive" order by name limit 1`);
  if (!admin) throw new Error("No active ADMIN in the local database");
  const adminToken = await tokenFor(admin);

  const clientId = rid();
  await q(`insert into clients (id,name,code,"contactPerson",address,"reportEmails","isArchived","createdAt","updatedAt")
           values ($1,$2,$3,'C','A','{}',false,now(),now())`, [clientId, P + "Client", P + "C1"]);

  // ══════════════════════════════════════════════════════════════════════
  section("1. An executive whose ONLY footprint is signing in and out is deletable");
  const sessionOnly = await mkExec("SessionOnly");
  await log(sessionOnly.id, "USER_LOGIN");
  await log(sessionOnly.id, "USER_LOGOUT");
  await log(sessionOnly.id, "USER_LOGIN");
  await q(`insert into attendance (id,"executiveId",date,"punchIn","isLate","createdAt","updatedAt")
           values ($1,$2,now(),now(),false,now(),now())`, [rid(), sessionOnly.id]);
  const before = await totals();

  const r1 = await del(sessionOnly.id, adminToken);
  eq(r1.status, 200, "delete succeeds");
  eq(await exists(sessionOnly.id), false, "the executive is gone");
  eq(r1.body.removed, { sessionLogs: 3, attendance: 1 }, "their sign-in rows and attendance went with them");
  const after = await totals();
  eq(after.users, before.users - 1, "exactly one user removed");
  eq(after.clients, before.clients, "no client touched");
  eq(after.visits, before.visits, "no visit touched");
  eq(after.tasks, before.tasks, "no task touched");
  eq(after.subtasks, before.subtasks, "no subtask touched");
  eq(after.attendance, before.attendance - 1, "only that executive's attendance removed");
  // 3 session logs removed, 1 EXECUTIVE_DELETED audit row written
  eq(after.logs, before.logs - 3 + 1, "only their sign-in logs removed; the deletion is audited");
  const audit = await q(`select action, metadata::text m from activity_logs
                         where action='EXECUTIVE_DELETED' order by "createdAt" desc limit 1`);
  ok(audit[0]?.m?.includes(P + "SessionOnly"), "the audit log names the deleted executive");

  // ══════════════════════════════════════════════════════════════════════
  section("2. Protection is UNCHANGED for an executive with real relationships");

  const withClient = await mkExec("HasClient");
  await q(`update clients set "assignedExecId"=$1 where id=$2`, [withClient.id, clientId]);
  const rc = await del(withClient.id, adminToken);
  eq(rc.status, 409, "an executive with an assigned client is refused");
  ok(/assigned client/.test(rc.body.error ?? ""), "  the message names the client", `("${rc.body.error}")`);
  ok(await exists(withClient.id), "  and the executive still exists");
  await q(`update clients set "assignedExecId"=null where id=$1`, [clientId]);

  const withVisit = await mkExec("HasVisit");
  const visitId = rid();
  await q(`insert into visits (id,"visitNumber","clientId","executiveId",status,"visitType","scheduledDate","createdAt","updatedAt")
           values ($1,$2,$3,$4,'PENDING','SOLO',now(),now(),now())`, [visitId, P + "V1", clientId, withVisit.id]);
  const rv = await del(withVisit.id, adminToken);
  eq(rv.status, 409, "an executive owning a visit is refused");
  ok(/visit/.test(rv.body.error ?? ""), "  the message names the visit", `("${rv.body.error}")`);
  ok(await exists(withVisit.id), "  and the executive still exists");

  const teamMember = await mkExec("TeamMember");
  await q(`insert into visit_assignments (id,"visitId","executiveId",role,"createdAt")
           values ($1,$2,$3,'MEMBER',now())`, [rid(), visitId, teamMember.id]);
  const rt = await del(teamMember.id, adminToken);
  eq(rt.status, 409, "a TEAM MEMBER is refused (this was not checked at all before)");
  ok(/team visit membership/.test(rt.body.error ?? ""), "  the message names the membership", `("${rt.body.error}")`);
  ok(await exists(teamMember.id), "  and the executive still exists");

  const didWork = await mkExec("DidWork");
  await log(didWork.id, "USER_LOGIN");
  await log(didWork.id, "VISIT_OPENED", visitId);
  const rw = await del(didWork.id, adminToken);
  eq(rw.status, 409, "an executive with a RECORDED ACTION is refused");
  ok(/recorded action/.test(rw.body.error ?? ""), "  the message names it", `("${rw.body.error}")`);
  ok(await exists(didWork.id), "  and the executive still exists");

  const onLeave = await mkExec("OnLeave");
  await q(`insert into leave_requests (id,"executiveId",date,reason,status,"createdAt","updatedAt")
           values ($1,$2,now(),'test','PENDING',now(),now())`, [rid(), onLeave.id]);
  const rl = await del(onLeave.id, adminToken);
  eq(rl.status, 409, "an executive with a leave request is refused");
  ok(await exists(onLeave.id), "  and still exists");

  // ══════════════════════════════════════════════════════════════════════
  section("3. Authorisation and edge cases");
  const spare = await mkExec("Spare");
  await log(spare.id, "USER_LOGIN");
  const execToken = await tokenFor(spare);
  eq((await del(spare.id, execToken)).status, 403, "an executive cannot delete executives");
  const anon = await fetch(`${BASE}/api/admin/executives/${spare.id}`, { method: "DELETE", redirect: "manual" });
  ok(anon.status === 401 || anon.status === 403 || anon.status === 307, `unauthenticated is refused (${anon.status})`);
  ok(await exists(spare.id), "the executive survived both attempts");
  eq((await del("does-not-exist", adminToken)).status, 404, "an unknown id returns 404");
  eq((await del(admin.id, adminToken)).status, 404, "an ADMIN cannot be deleted through this route");

  section("4. Nothing else changed");
  const end = await totals();
  eq(end.clients, before.clients, "client count unchanged across the whole test");
  eq(end.visits, before.visits + 1, "only this test's own visit was added");
}

const t0 = Date.now();
main()
  .catch((e) => { fail++; console.error("\nERROR:", e.message); })
  .finally(async () => {
    await cleanup();
    eq(Number((await q(`select count(*)::int c from users where name like $1`, [P + "%"]))[0].c), 0, "no fixtures left behind");
    console.log(`\n=== ${pass} passed, ${fail} failed  (${Date.now() - t0}ms) ===`);
    await pool.end();
    process.exit(fail ? 1 : 0);
  });
