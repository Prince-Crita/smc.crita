/**
 * Regression test — an assigned visit always carries the client's configured work.
 *
 * The production failure this guards (Kandavel Knitwear, 22 Aug 2026):
 * a carry-forward destination visit only ever receives the main tasks its
 * CARRIED items need, and it receives them EMPTY — a task is created purely to
 * hold a carried subtask. When an admin later removes those carried subtasks,
 * the tasks remain as empty shells and the client's configured task types that
 * had no carried item were never created at all. The visit is then assigned to
 * a team through Client → Edit Client, and both executives are handed a visit
 * with nothing to do.
 *
 * Nothing back-filled it: the full configuration sync runs only when an admin
 * edits Task Configuration, which may never happen again for that client.
 *
 * Locked down here, for BOTH workflows and BOTH visit types:
 *   Workflow 1  Admin → Calendar → New Visit          (POST /api/admin/visits)
 *   Workflow 2  Admin → Clients → Edit Client         (PATCH /api/admin/clients/[id])
 *               Admin → Visit → change assignment     (PATCH .../visits/[id]/assignment)
 *
 * …while proving Rule 2 still holds: a carry-forward-ONLY visit that merely
 * supplements a real visit that week stays a pure container.
 *
 * Local database only. Creates its own ZZAT_ fixtures and removes them always.
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
const P = "ZZAT_";
const pool = new pg.Pool({ connectionString: DB, ssl: false });
const q = async (s, p) => (await pool.query(s, p ?? [])).rows;
const secret = new TextEncoder().encode(process.env.JWT_SECRET);
const rid = () => "zzat_" + Math.random().toString(36).slice(2, 11) + Date.now().toString(36);

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
           values ($1,$2,$3,'x','EXECUTIVE',true,now(),now())`, [id, P + name, `${id}@zzat.invalid`]);
  const u = { id, name: P + name, email: `${id}@zzat.invalid`, role: "EXECUTIVE" };
  u.token = await tokenFor(u);
  return u;
}

function mondayUTC(d) {
  const m = new Date(d); const dow = m.getUTCDay();
  m.setUTCDate(m.getUTCDate() + (dow === 0 ? -6 : 1 - dow)); m.setUTCHours(0, 0, 0, 0); return m;
}
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const isoDay = (d) => d.toISOString().slice(0, 10);

async function structureOf(visitId) {
  const tasks = await q(`select id,"taskType",title from tasks where "visitId"=$1 order by "taskType"`, [visitId]);
  const out = {};
  for (const t of tasks) {
    out[t.taskType] = (await q(`select title from subtasks where "taskId"=$1 order by title`, [t.id])).map((s) => s.title);
  }
  return out;
}
const typesOf = (s) => Object.keys(s).sort();
const subtaskCount = (s) => Object.values(s).reduce((n, a) => n + a.length, 0);

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

// Kandavel Knitwear's real shape: two default types renamed, none deleted,
// eleven client-specific subtask templates spread over all six types.
const RENAMED = [["OPERATIONAL_VERIFICATION", "Weekly Wages Verification"], ["ACCOUNTS_VERIFICATION", "Costing Verification"]];
const TEMPLATES = [
  ["OPERATIONAL_VERIFICATION", ["Contract and Labour wages", "Contract Advance Verification"]],
  ["STOCK_VERIFICATION", ["Ccr fabric stock", "Ocr pcs stock"]],
  ["AVF_REPORT", ["All process outstanding report", "All closure report", "All Po Pending reports", "Bill pass pending status"]],
  ["ACCOUNTS_VERIFICATION", ["Post costing report"]],
  ["MR_MONTHLY_REPORT", ["Overhead report"]],
  ["MD_MEETING", ["Weekly Report Review"]],
];
const ALL_TYPES = ["ACCOUNTS_VERIFICATION", "AVF_REPORT", "MD_MEETING", "MR_MONTHLY_REPORT",
                   "OPERATIONAL_VERIFICATION", "STOCK_VERIFICATION"];
const ALL_SUBTASKS = 11;

async function main() {
  await cleanup();

  const [admin] = await q(`select id,email,name,role from users where role='ADMIN' and "isActive" order by name limit 1`);
  if (!admin) throw new Error("No active ADMIN in the local database");
  admin.token = await tokenFor(admin);

  const lead = await mkUser("Alagarsamy");
  const member = await mkUser("Muthusamy");

  const clientId = rid();
  await q(`insert into clients (id,name,code,"contactPerson",address,"reportEmails","isArchived","createdAt","updatedAt")
           values ($1,$2,$3,'C','A','{}',false,now(),now())`, [clientId, P + "Kandavel Knitwear", P + "KAN"]);
  for (const [taskType, title] of RENAMED)
    await q(`insert into client_task_types (id,"clientId","taskType",title,"orderIndex","isDeleted","createdAt","updatedAt")
             values ($1,$2,$3,$4,null,false,now(),now())`, [rid(), clientId, taskType, title]);
  for (const [taskType, titles] of TEMPLATES)
    for (let i = 0; i < titles.length; i++)
      await q(`insert into subtask_templates (id,"taskType",title,"orderIndex","isActive","clientId","createdAt","updatedAt")
               values ($1,$2,$3,$4,true,$5,now(),now())`, [rid(), taskType, titles[i], i + 1, clientId]);

  const weekA = mondayUTC(addDays(new Date(), 7));
  const weekB = addDays(weekA, 7);

  // ══════════════════════════════════════════════════════════════════════
  section("1. WORKFLOW 1 — Admin → Calendar → New Visit");
  for (const [label, payload, when] of [
    ["SOLO", { visitType: "SOLO" }, isoDay(weekA)],
    ["TEAM", { visitType: "TEAM", memberIds: [member.id] }, isoDay(addDays(weekA, 1))],
  ]) {
    const r = await api("/api/admin/visits", admin.token, {
      method: "POST",
      body: JSON.stringify({ clientId, executiveId: lead.id, scheduledDate: when, ...payload }),
    });
    eq(r.status, 201, `${label} visit created`);
    const s = await structureOf(r.body.visit?.id);
    eq(typesOf(s), ALL_TYPES, `  ${label}: all 6 configured main tasks present`);
    eq(subtaskCount(s), ALL_SUBTASKS, `  ${label}: all 11 configured subtasks present`);
    eq(s.OPERATIONAL_VERIFICATION?.length, 2, `  ${label}: renamed type keeps its subtasks`);
  }

  // ══════════════════════════════════════════════════════════════════════
  section("2. THE PRODUCTION FAILURE — a stripped carry-forward visit assigned to a team");
  // Reproduce exactly: a visit holding only carried subtasks, whose carried
  // items were then removed by an admin, leaving empty task shells and two
  // configured task types absent entirely.
  const brokenId = rid();
  await q(`insert into visits (id,"visitNumber","clientId","executiveId",status,"visitType","scheduledDate","endDate","createdAt","updatedAt")
           values ($1,$2,$3,$4,'PENDING','SOLO',$5,$5,now(),now())`,
    [brokenId, P + "BROKEN", clientId, lead.id, addDays(weekA, 2)]);
  for (const [i, tt] of ["ACCOUNTS_VERIFICATION", "STOCK_VERIFICATION", "OPERATIONAL_VERIFICATION", "AVF_REPORT"].entries())
    await q(`insert into tasks (id,"visitId","taskType",title,status,"orderIndex","createdAt","updatedAt")
             values ($1,$2,$3,$4,'PENDING',$5,now(),now())`, [rid(), brokenId, tt, tt, i]);

  const before = await structureOf(brokenId);
  eq(typesOf(before), ["ACCOUNTS_VERIFICATION", "AVF_REPORT", "OPERATIONAL_VERIFICATION", "STOCK_VERIFICATION"],
    "the broken visit starts with 4 task shells");
  eq(subtaskCount(before), 0, "  …and ZERO subtasks — exactly the reported state");

  section("   Admin → Visit → change assignment to a TEAM");
  const asg = await api(`/api/admin/visits/${brokenId}/assignment`, admin.token, {
    method: "PATCH",
    body: JSON.stringify({ visitType: "TEAM", executiveId: lead.id, memberIds: [member.id] }),
  });
  eq(asg.status, 200, "assignment accepted");
  const after = await structureOf(brokenId);
  eq(typesOf(after), ALL_TYPES, "THE FIX: the two missing configured task types were added");
  eq(subtaskCount(after), ALL_SUBTASKS, "  every configured subtask is now present");
  eq((await q(`select a.role,u.name from visit_assignments a join users u on u.id=a."executiveId"
               where a."visitId"=$1 order by a.role`, [brokenId])).map((r) => `${r.role}:${r.name}`),
    [`LEAD:${P}Alagarsamy`, `MEMBER:${P}Muthusamy`], "  lead and member are assigned");

  section("   both executives see the work through the real API");
  for (const [who, u] of [["lead", lead], ["member", member]]) {
    const r = await api(`/api/visits/${brokenId}`, u.token);
    eq(r.status, 200, `  the ${who} can read the visit`);
    const types = (r.body.visit?.tasks ?? []).map((t) => t.taskType).sort();
    eq(types, ALL_TYPES, `  the ${who} sees all 6 main tasks`);
    eq((r.body.visit?.tasks ?? []).reduce((n, t) => n + (t.subtasks?.length ?? 0), 0), ALL_SUBTASKS,
      `  the ${who} sees all 11 subtasks`);
  }

  section("   running the same assignment again is idempotent");
  const again = await api(`/api/admin/visits/${brokenId}/assignment`, admin.token, {
    method: "PATCH",
    body: JSON.stringify({ visitType: "TEAM", executiveId: lead.id, memberIds: [member.id] }),
  });
  eq(again.status, 200, "second assignment accepted");
  const twice = await structureOf(brokenId);
  eq(typesOf(twice), ALL_TYPES, "  still exactly 6 main tasks — nothing duplicated");
  eq(subtaskCount(twice), ALL_SUBTASKS, "  still exactly 11 subtasks — nothing duplicated");

  // ══════════════════════════════════════════════════════════════════════
  section("3. WORKFLOW 2 — Admin → Clients → Edit Client");
  const broken2 = rid();
  await q(`insert into visits (id,"visitNumber","clientId","executiveId",status,"visitType","scheduledDate","endDate","createdAt","updatedAt")
           values ($1,$2,$3,$4,'PENDING','SOLO',$5,$5,now(),now())`,
    [broken2, P + "BROKEN2", clientId, lead.id, addDays(weekA, 3)]);
  await q(`insert into tasks (id,"visitId","taskType",title,status,"orderIndex","createdAt","updatedAt")
           values ($1,$2,'STOCK_VERIFICATION','Stock Verification','PENDING',0,now(),now())`, [rid(), broken2]);
  eq(subtaskCount(await structureOf(broken2)), 0, "a second stripped visit exists with 1 empty task");

  const edit = await api(`/api/admin/clients/${clientId}`, admin.token, {
    method: "PATCH",
    body: JSON.stringify({ assignedExecId: lead.id, visitType: "TEAM", memberIds: [member.id] }),
  });
  ok(edit.status === 200, "client edit accepted", `(${edit.status})`);
  const s2 = await structureOf(broken2);
  eq(typesOf(s2), ALL_TYPES, "THE FIX: editing the client filled in its configured tasks");
  eq(subtaskCount(s2), ALL_SUBTASKS, "  with every configured subtask");

  // ══════════════════════════════════════════════════════════════════════
  section("4. Rule 2 preserved — a supplementary carry-forward visit stays a container");
  // A normal visit already covers this week, so a carry-forward-only visit in
  // the same week must NOT be filled with a second copy of the configuration.
  const normalId = rid();
  await q(`insert into visits (id,"visitNumber","clientId","executiveId",status,"visitType","scheduledDate","createdAt","updatedAt")
           values ($1,$2,$3,$4,'PENDING','SOLO',$5,now(),now())`, [normalId, P + "NORMALB", clientId, lead.id, addDays(weekB, 1)]);
  const cfId = rid();
  await q(`insert into visits (id,"visitNumber","clientId","executiveId",status,"visitType","scheduledDate",notes,"createdAt","updatedAt")
           values ($1,$2,$3,$4,'PENDING','SOLO',$5,$6,now(),now())`,
    [cfId, P + "CFONLY", clientId, lead.id, addDays(weekB, 2), "[CARRY-FORWARD: test] [CF-SUBTASKS-ONLY]"]);
  const cfTask = rid();
  await q(`insert into tasks (id,"visitId","taskType",title,status,"orderIndex","createdAt","updatedAt")
           values ($1,$2,'MD_MEETING','MD Meeting','PENDING',0,now(),now())`, [cfTask, cfId]);
  await q(`insert into subtasks (id,"taskId",title,"isCompleted","isCarriedForward","createdAt","updatedAt")
           values ($1,$2,'[CARRY-FORWARD] Weekly Report Review',false,true,now(),now())`, [rid(), cfTask]);

  const cfAsg = await api(`/api/admin/visits/${cfId}/assignment`, admin.token, {
    method: "PATCH", body: JSON.stringify({ visitType: "TEAM", executiveId: lead.id, memberIds: [member.id] }),
  });
  eq(cfAsg.status, 200, "assigning the carry-forward-only visit is accepted");
  const cfAfter = await structureOf(cfId);
  eq(typesOf(cfAfter), ["MD_MEETING"], "it still holds ONLY the carried item's task — Rule 2 intact");
  eq(subtaskCount(cfAfter), 1, "  and only the carried subtask");
  ok(cfAfter.MD_MEETING[0].includes("Weekly Report Review"), "  the carried subtask itself is untouched");

  // ══════════════════════════════════════════════════════════════════════
  section("5. Existing work is never replaced");
  const guardId = rid();
  await q(`insert into visits (id,"visitNumber","clientId","executiveId",status,"visitType","scheduledDate","createdAt","updatedAt")
           values ($1,$2,$3,$4,'OPEN','SOLO',$5,now(),now())`, [guardId, P + "GUARD", clientId, lead.id, addDays(weekA, 4)]);
  const gTask = rid();
  await q(`insert into tasks (id,"visitId","taskType",title,status,"orderIndex","createdAt","updatedAt")
           values ($1,$2,'STOCK_VERIFICATION','Stock Verification','PENDING',0,now(),now())`, [gTask, guardId]);
  const doneId = rid(), carriedId = rid();
  await q(`insert into subtasks (id,"taskId",title,"isCompleted","isCarriedForward","createdAt","updatedAt")
           values ($1,$2,'Ccr fabric stock',true,false,now(),now())`, [doneId, gTask]);
  await q(`insert into subtasks (id,"taskId",title,"isCompleted","isCarriedForward","createdAt","updatedAt")
           values ($1,$2,'[CARRY-FORWARD] Ocr pcs stock',false,true,now(),now())`, [carriedId, gTask]);

  await api(`/api/admin/visits/${guardId}/assignment`, admin.token, {
    method: "PATCH", body: JSON.stringify({ visitType: "TEAM", executiveId: lead.id, memberIds: [member.id] }),
  });
  eq(Number((await q(`select count(*)::int c from subtasks where id=$1 and "isCompleted"`, [doneId]))[0].c), 1,
    "the COMPLETED subtask survives, still completed");
  eq(Number((await q(`select count(*)::int c from subtasks where id=$1 and "isCarriedForward"`, [carriedId]))[0].c), 1,
    "the CARRIED subtask survives, still carried");
  const g = await structureOf(guardId);
  eq(g.STOCK_VERIFICATION.length, 2, "  Stock Verification still holds exactly its 2 items — no duplicate twin");
  eq(typesOf(g), ALL_TYPES, "  and the missing configured types were added around them");

  // ══════════════════════════════════════════════════════════════════════
  section("6. Closing a visit no longer erases its carry-forward markers");
  const markerId = rid();
  await q(`insert into visits (id,"visitNumber","clientId","executiveId",status,"visitType","scheduledDate",notes,"openedAt","createdAt","updatedAt")
           values ($1,$2,$3,$4,'OPEN','SOLO',$5,$6,now(),now(),now())`,
    [markerId, P + "MARKER", clientId, lead.id, addDays(weekA, 5), "[CARRY-FORWARD: Incomplete items from X] [CF-SUBTASKS-ONLY]"]);
  const mTask = rid();
  await q(`insert into tasks (id,"visitId","taskType",title,status,"orderIndex","mdMeetingAnswer","createdAt","updatedAt")
           values ($1,$2,'MD_MEETING','MD Meeting','PENDING',0,'NO',now(),now())`, [mTask, markerId]);
  await q(`insert into subtasks (id,"taskId",title,"isCompleted","isCarriedForward","incompletionReason","createdAt","updatedAt")
           values ($1,$2,'Weekly Report Review',false,false,'not available',now(),now())`, [rid(), mTask]);

  const closed = await api(`/api/visits/${markerId}/close`, lead.token, {
    method: "POST", body: JSON.stringify({ notes: "" }),
  });
  eq(closed.status, 200, "the visit closes with an empty note box");
  const notesAfter = (await q(`select notes from visits where id=$1`, [markerId]))[0].notes;
  ok(notesAfter?.includes("[CARRY-FORWARD:"), "the carry-forward marker SURVIVES the close", `(${JSON.stringify(notesAfter)})`);
  ok(notesAfter?.includes("[CF-SUBTASKS-ONLY]"), "  and so does the Rule-2 marker");

  const marker2 = rid();
  await q(`insert into visits (id,"visitNumber","clientId","executiveId",status,"visitType","scheduledDate",notes,"openedAt","createdAt","updatedAt")
           values ($1,$2,$3,$4,'OPEN','SOLO',$5,$6,now(),now(),now())`,
    [marker2, P + "MARKER2", clientId, lead.id, addDays(weekA, 6), "[CARRY-FORWARD: keep me]"]);
  const m2Task = rid();
  await q(`insert into tasks (id,"visitId","taskType",title,status,"orderIndex","mdMeetingAnswer","createdAt","updatedAt")
           values ($1,$2,'MD_MEETING','MD Meeting','COMPLETED',0,'YES',now(),now())`, [m2Task, marker2]);
  await q(`insert into subtasks (id,"taskId",title,"isCompleted","isCarriedForward","createdAt","updatedAt")
           values ($1,$2,'Weekly Report Review',true,false,now(),now())`, [rid(), m2Task]);
  const closed2 = await api(`/api/visits/${marker2}/close`, lead.token, {
    method: "POST", body: JSON.stringify({ notes: "All done on site." }),
  });
  eq(closed2.status, 200, "a visit closes WITH a note");
  const n2 = (await q(`select notes from visits where id=$1`, [marker2]))[0].notes;
  ok(n2?.includes("[CARRY-FORWARD: keep me]"), "  the marker is kept");
  ok(n2?.includes("All done on site."), "  and the executive's note is appended, not substituted");

  // ══════════════════════════════════════════════════════════════════════
  section("7. No duplicates anywhere for this client");
  eq((await q(`select t."visitId",t."taskType",count(*)::int c from tasks t join visits v on v.id=t."visitId"
               where v."clientId"=$1 group by 1,2 having count(*)>1`, [clientId])).length, 0,
    "no visit holds the same main task type twice");
  eq((await q(`select s."taskId",lower(replace(s.title,'[CARRY-FORWARD] ','')) t,count(*)::int c
               from subtasks s join tasks tk on tk.id=s."taskId" join visits v on v.id=tk."visitId"
               where v."clientId"=$1 group by 1,2 having count(*)>1`, [clientId])).length, 0,
    "no task holds the same subtask title twice");
  eq((await q(`select "scheduledDate"::date d,count(*)::int c from visits where "clientId"=$1
               group by 1 having count(*)>1`, [clientId])).length, 0,
    "no two visits share a date for this client");
  eq(Number((await q(`select count(*)::int c from client_task_types where "clientId"=$1`, [clientId]))[0].c), 2,
    "the client's task configuration is unchanged");
  eq(Number((await q(`select count(*)::int c from subtask_templates where "clientId"=$1`, [clientId]))[0].c), 11,
    "the client's subtask templates are unchanged");
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
