/**
 * Regression test — Team Visit assignment, visibility and admin display.
 *
 * Guards the behaviour reported broken in production: an admin creates a TEAM
 * visit with a lead and members, and the members must be persisted, visible to
 * those members, hidden from everyone else, closable only by the lead — and,
 * crucially, VISIBLE TO THE ADMIN when the visit is reopened. The admin detail
 * page previously selected only `executive`, so a correctly assigned team read
 * as "the members were never assigned".
 *
 * Drives the real HTTP API, creates its own ZZTV_ fixtures, cleans up always.
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
const P = "ZZTV_";
const pool = new pg.Pool({ connectionString: DB, ssl: false });
const q = async (s, p) => (await pool.query(s, p ?? [])).rows;
const secret = new TextEncoder().encode(process.env.JWT_SECRET);
const rid = () => "zztv_" + Math.random().toString(36).slice(2, 11) + Date.now().toString(36);

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
const page = (path, token) =>
  fetch(`${BASE}${path}`, { headers: { cookie: `smc_token=${token}` }, redirect: "manual" })
    .then(async (r) => ({ status: r.status, html: await r.text() }));

async function mkUser(name) {
  const id = rid();
  await q(`insert into users (id,name,email,"passwordHash",role,"isActive","createdAt","updatedAt")
           values ($1,$2,$3,'x','EXECUTIVE',true,now(),now())`, [id, P + name, `${id}@zztv.invalid`]);
  const u = { id, name: P + name, email: `${id}@zztv.invalid`, role: "EXECUTIVE" };
  u.token = await tokenFor(u);
  return u;
}

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
    await q(`update subtasks set "carryForwardApprovedById"=null where "carryForwardApprovedById"=any($1)`, [us]);
    await q(`delete from activity_logs where "userId"=any($1)`, [us]);
    await q(`delete from admin_operations where "userId"=any($1) or "undoneById"=any($1)`, [us]);
  }
  if (cl.length) {
    await q(`delete from subtask_templates where "clientId"=any($1)`, [cl]);
    await q(`delete from client_task_types where "clientId"=any($1)`, [cl]);
    await q(`delete from clients where id=any($1)`, [cl]);
  }
  if (us.length) await q(`delete from users where id=any($1)`, [us]);
}

async function main() {
  await cleanup();

  const [admin] = await q(`select id,email,name,role from users where role='ADMIN' and "isActive" order by name limit 1`);
  if (!admin) throw new Error("No active ADMIN in the local database");
  admin.token = await tokenFor(admin);

  const lead = await mkUser("Lead");
  const m1 = await mkUser("Member1");
  const m2 = await mkUser("Member2");
  const outsider = await mkUser("Outsider");

  const clientId = rid();
  await q(`insert into clients (id,name,code,"contactPerson",address,"reportEmails","isArchived","createdAt","updatedAt")
           values ($1,$2,$3,'C','A','{}',false,now(),now())`, [clientId, P + "Client", P + "C1"]);
  // Client-specific templates so the visit actually scaffolds tasks/subtasks
  // and the parallel-work check below has something real to work on.
  for (const [taskType, title, n] of [["STOCK_VERIFICATION", "Stock Verification", 2], ["AVF_REPORT", "AVF Report", 2]]) {
    for (let i = 0; i < n; i++) {
      await q(`insert into subtask_templates (id,"taskType",title,"orderIndex","isActive","clientId","createdAt","updatedAt")
               values ($1,$2,$3,$4,true,$5,now(),now())`, [rid(), taskType, `${title} item ${i + 1}`, i, clientId]);
    }
  }

  const when = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

  // ══════════════════════════════════════════════════════════════════════
  section("1. Admin creates a SOLO visit (existing behaviour must not change)");
  const solo = await api("/api/admin/visits", admin.token, {
    method: "POST",
    body: JSON.stringify({ clientId, executiveId: lead.id, scheduledDate: when, visitType: "SOLO" }),
  });
  eq(solo.status, 201, "solo visit created");
  const soloId = solo.body.visit?.id ?? solo.body.id;
  const soloRow = (await q(`select "visitType" from visits where id=$1`, [soloId]))[0];
  eq(soloRow?.visitType, "SOLO", "stored as SOLO");
  eq(Number((await q(`select count(*)::int c from visit_assignments where "visitId"=$1`, [soloId]))[0].c), 0,
    "a solo visit creates no assignment rows");

  // ══════════════════════════════════════════════════════════════════════
  section("2. Admin creates a TEAM visit with a lead and TWO members");
  const team = await api("/api/admin/visits", admin.token, {
    method: "POST",
    body: JSON.stringify({
      clientId, executiveId: lead.id, scheduledDate: when,
      visitType: "TEAM", memberIds: [m1.id, m2.id],
    }),
  });
  eq(team.status, 201, "team visit created");
  const teamId = team.body.visit?.id ?? team.body.id;
  ok(!!teamId, "the API returned the new visit id");

  const rows = await q(
    `select a.role, u.name from visit_assignments a join users u on u.id=a."executiveId"
     where a."visitId"=$1 order by a.role, u.name`, [teamId]);
  eq(rows.map((r) => `${r.role}:${r.name}`),
    [`LEAD:${P}Lead`, `MEMBER:${P}Member1`, `MEMBER:${P}Member2`],
    "lead AND both members are persisted in visit_assignments");
  eq((await q(`select "visitType","executiveId" from visits where id=$1`, [teamId]))[0].visitType, "TEAM", "stored as TEAM");
  eq((await q(`select "executiveId" from visits where id=$1`, [teamId]))[0].executiveId, lead.id, "the lead owns the visit row");

  // ══════════════════════════════════════════════════════════════════════
  section("3. Admin can SEE the members when reopening the visit (the reported bug)");
  const detail = await page(`/admin/visits/${teamId}`, admin.token);
  eq(detail.status, 200, "admin visit detail page renders");
  ok(detail.html.includes(`${P}Lead`), "the page shows the team lead");
  ok(detail.html.includes(`${P}Member1`), "the page shows member 1");
  ok(detail.html.includes(`${P}Member2`), "the page shows member 2");
  ok(/Team Lead/.test(detail.html), "the lead is labelled 'Team Lead' on a team visit");

  const soloDetail = await page(`/admin/visits/${soloId}`, admin.token);
  ok(!/Team Lead/.test(soloDetail.html), "a SOLO visit still says 'Executive', not 'Team Lead'");

  section("4. Admin list filtered by a MEMBER includes the team visit");
  const byMember = await api(`/api/admin/visits?executiveId=${m1.id}`, admin.token);
  const ids = (byMember.body.visits ?? []).map((v) => v.id);
  ok(ids.includes(teamId), "filtering the admin visit list by a member returns the team visit");
  const byLead = await api(`/api/admin/visits?executiveId=${lead.id}`, admin.token);
  ok((byLead.body.visits ?? []).map((v) => v.id).includes(teamId), "filtering by the lead returns it too");
  const byOutsider = await api(`/api/admin/visits?executiveId=${outsider.id}`, admin.token);
  ok(!(byOutsider.body.visits ?? []).map((v) => v.id).includes(teamId), "filtering by an unrelated executive does not");

  // ══════════════════════════════════════════════════════════════════════
  section("5. Executive visibility");
  for (const [who, u] of [["lead", lead], ["member 1", m1], ["member 2", m2]]) {
    const r = await api("/api/visits", u.token);
    ok((r.body.visits ?? []).some((v) => v.id === teamId), `${who} sees the team visit`);
  }
  const outs = await api("/api/visits", outsider.token);
  ok(!(outs.body.visits ?? []).some((v) => v.id === teamId), "an unrelated executive does NOT see it");
  eq((await api(`/api/visits/${teamId}`, outsider.token)).status, 403, "and is refused the detail endpoint");

  section("6. Lead-only close");
  const opened = await api(`/api/visits/${teamId}`, lead.token, { method: "PATCH", body: "{}" });
  eq(opened.status, 200, "the lead can open the visit");
  const st = (await q(`select status from visits where id=$1`, [teamId]))[0].status;
  eq(st, "OPEN", "the visit is OPEN");
  const memberClose = await api(`/api/visits/${teamId}/close`, m1.token, { method: "POST", body: "{}" });
  eq(memberClose.status, 403, "a member cannot close the team visit");
  ok(/Team Lead/i.test(JSON.stringify(memberClose.body)), "  and is told why");
  eq((await q(`select status from visits where id=$1`, [teamId]))[0].status, st, "the visit status is unchanged by that attempt");

  section("7. Parallel work by lead and member synchronises");
  // Only the two task types this fixture supplied templates for actually have
  // subtasks; the other scaffolded task types are empty by design.
  const tasks = await q(
    `select t.id, t."taskType" from tasks t
     where t."visitId"=$1 and exists (select 1 from subtasks s where s."taskId"=t.id)
     order by t."orderIndex"`, [teamId]);
  ok(tasks.length >= 2, "the team visit scaffolded tasks with subtasks", `(${tasks.length} tasks with work)`);
  const subsA = await q(`select id from subtasks where "taskId"=$1 order by "createdAt"`, [tasks[0].id]);
  const subsB = await q(`select id from subtasks where "taskId"=$1 order by "createdAt"`, [tasks[1].id]);
  ok(subsA.length >= 1 && subsB.length >= 1, "both tasks have subtasks", `(${subsA.length}/${subsB.length})`);

  // The LEAD completes an item on task A while the MEMBER completes one on
  // task B — genuinely parallel work on the same visit.
  const complete = (taskId, subId, token) =>
    api(`/api/tasks/${taskId}/complete`, token, {
      method: "PATCH", body: JSON.stringify({ subtasks: [{ id: subId, isCompleted: true }] }),
    });
  const [rLead, rMember] = await Promise.all([
    complete(tasks[0].id, subsA[0].id, lead.token),
    complete(tasks[1].id, subsB[0].id, m1.token),
  ]);
  eq(rLead.status, 200, "the LEAD can complete a subtask");
  eq(rMember.status, 200, "a MEMBER can complete a subtask");
  const doneIds = [subsA[0].id, subsB[0].id];
  eq(Number((await q(`select count(*)::int c from subtasks where id=any($1) and "isCompleted"`, [doneIds]))[0].c), 2,
    "both completions are persisted");

  const outsiderTry = await complete(tasks[0].id, subsA[1]?.id ?? subsA[0].id, outsider.token);
  eq(outsiderTry.status, 403, "an unrelated executive cannot complete this visit's subtasks");

  const adminSees = await api("/api/admin/visits", admin.token);
  const v = (adminSees.body.visits ?? []).find((x) => x.id === teamId);
  ok(v && v.completedSubtasks >= 2, "the admin list shows the COMBINED progress of both executives",
    `(completed=${v?.completedSubtasks} of ${v?.totalSubtasks})`);
  const leadView = await api(`/api/visits/${teamId}`, lead.token);
  const memberView = await api(`/api/visits/${teamId}`, m1.token);
  eq(memberView.status, 200, "the member can read the synchronised visit");
  const leadDone = JSON.stringify(leadView.body).match(/"isCompleted":true/g)?.length ?? 0;
  const memberDone = JSON.stringify(memberView.body).match(/"isCompleted":true/g)?.length ?? 0;
  eq(leadDone, memberDone, "lead and member see the SAME completion state");

  section("8. No duplicates");
  eq(Number((await q(`select count(*)::int c from visits where "clientId"=$1`, [clientId]))[0].c), 2,
    "exactly the two visits created by this test exist for the client");
  eq(Number((await q(`select count(*)::int c from visit_assignments where "visitId"=$1`, [teamId]))[0].c), 3,
    "exactly 3 assignment rows (1 lead + 2 members)");
}

const t0 = Date.now();
main()
  .catch((e) => { fail++; console.error("\nERROR:", e.message); })
  .finally(async () => {
    await cleanup();
    const left = Number((await q(`select count(*)::int c from users where name like $1`, [P + "%"]))[0].c)
      + Number((await q(`select count(*)::int c from clients where code like $1`, [P + "%"]))[0].c);
    eq(left, 0, "the test left no data behind");
    console.log(`\n=== ${pass} passed, ${fail} failed  (${Date.now() - t0}ms) ===`);
    await pool.end();
    process.exit(fail ? 1 : 0);
  });
