/**
 * Regression test — the ADMIN-APPROVED carry-forward workflow.
 *
 *   executive leaves a subtask incomplete + reason
 *     → visit closed
 *     → item becomes a PENDING request on Admin → Carry Forward
 *     → HIDDEN from the executive until an admin approves
 *     → Reject: never reaches the executive
 *     → Approve: admin picks the date + executive; the item lands on that
 *       executive's visit for that date, REUSING the client's existing visit
 *       instead of creating a duplicate
 *     → executive can re-date it from the popup without duplicating anything
 *
 * Drives the real HTTP API so authorisation and route logic are exercised.
 * Creates its own fixtures under the ZZCF_ prefix and removes every row it
 * created before exiting, including on failure.
 *
 * Usage:
 *   1. npm run dev
 *   2. node scripts/test-carry-forward-workflow.mjs
 *
 * Safety: reads DATABASE_URL from .env.development.local and REFUSES to run
 * against anything that is not localhost.
 */
import { config } from "dotenv";
import { SignJWT } from "jose";
import pg from "pg";

config({ path: ".env.development.local", quiet: true });
config({ path: ".env.local", quiet: true }); // JWT_SECRET only

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL || !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(DB_URL)) {
  console.error("Refusing to run: DATABASE_URL is not a localhost database.");
  process.exit(2);
}

const BASE = process.env.TEST_BASE_URL || "http://localhost:3000";
const P = "ZZCF_";

// `timestamp without time zone` (oid 1114) is parsed by node-postgres in the
// process's LOCAL zone, while Prisma reads and writes those columns as UTC.
// On an IST machine that shifts every date by 5h30m and makes the assertions
// disagree with the application for no real reason. Parse them as UTC, and
// pass ISO strings on the way in, so the harness and Prisma agree.
pg.types.setTypeParser(1114, (s) => new Date(s + "Z"));
const pool = new pg.Pool({ connectionString: DB_URL, ssl: false });
const q = async (sql, params) => (await pool.query(sql, params ?? [])).rows;
const secret = new TextEncoder().encode(process.env.JWT_SECRET);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  PASS", m); } else { fail++; console.log("  FAIL", m); } };
const eq = (g, w, m) => ok(JSON.stringify(g) === JSON.stringify(w), `${m}  (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`);
const section = (s) => console.log(`\n${s}`);

const rid = () => "zzcf_" + Math.random().toString(36).slice(2, 11) + Date.now().toString(36);

// ── IST day helpers, mirroring src/lib/utils/attendance.ts ──────────────────
const IST = 5.5 * 60 * 60 * 1000;
const midnightIST = (d) => {
  const s = new Date(d.getTime() + IST);
  return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()) - IST);
};
const daysFromNow = (n) => midnightIST(new Date(Date.now() + n * 86400000));

async function tokenFor(user) {
  return new SignJWT({ userId: user.id, email: user.email, name: user.name, role: user.role })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secret);
}
const api = (path, token, init = {}) =>
  fetch(`${BASE}${path}`, {
    ...init,
    redirect: "manual",
    headers: { "content-type": "application/json", cookie: `smc_token=${token}`, ...(init.headers || {}) },
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

// ── fixtures ────────────────────────────────────────────────────────────────
const F = { users: [], clientId: null, visitIds: [] };

async function mkUser(name, role) {
  const id = rid();
  await q(`insert into users (id,name,email,"passwordHash",role,"isActive","createdAt","updatedAt")
           values ($1,$2,$3,'x',$4,true,now(),now())`, [id, P + name, `${id}@zzcf.invalid`, role]);
  const u = { id, name: P + name, email: `${id}@zzcf.invalid`, role };
  u.token = await tokenFor(u);
  F.users.push(u);
  return u;
}
async function mkVisit({ clientId, executiveId, status, date, endDate, number, notes = null }) {
  const id = rid();
  await q(`insert into visits (id,"visitNumber","clientId","executiveId",status,"visitType","scheduledDate","endDate",notes,"createdAt","updatedAt")
           values ($1,$2,$3,$4,$5,'SOLO',$6,$7,$8,now(),now())`,
    [id, P + number, clientId, executiveId, status, date.toISOString(), endDate ? endDate.toISOString() : null, notes]);
  F.visitIds.push(id);
  return id;
}
async function mkTask(visitId, taskType, title, orderIndex = 0) {
  const id = rid();
  await q(`insert into tasks (id,"visitId","taskType",title,status,"orderIndex","createdAt","updatedAt")
           values ($1,$2,$3,$4,'PENDING',$5,now(),now())`, [id, visitId, taskType, title, orderIndex]);
  return id;
}
async function mkSubtask(taskId, title, { isCompleted = false, reason = null } = {}) {
  const id = rid();
  await q(`insert into subtasks (id,"taskId",title,"isCompleted","incompletionReason","isCarriedForward","createdAt","updatedAt")
           values ($1,$2,$3,$4,$5,false,now(),now())`, [id, taskId, title, isCompleted, reason]);
  return id;
}

async function cleanup() {
  const clientIds = (await q(`select id from clients where code like $1`, [P + "%"])).map((r) => r.id);
  const userIds = (await q(`select id from users where name like $1`, [P + "%"])).map((r) => r.id);
  const visitIds = (await q(
    `select id from visits where "visitNumber" like $1 or "clientId" = any($2) or "executiveId" = any($3)`,
    [P + "%", clientIds, userIds])).map((r) => r.id);

  if (visitIds.length) {
    const taskIds = (await q(`select id from tasks where "visitId" = any($1)`, [visitIds])).map((r) => r.id);
    if (taskIds.length) {
      const stIds = (await q(`select id from subtasks where "taskId" = any($1)`, [taskIds])).map((r) => r.id);
      if (stIds.length) await q(`update subtasks set "sourceSubtaskId"=null where "sourceSubtaskId" = any($1)`, [stIds]);
    }
    await q(`delete from activity_logs where "visitId" = any($1)`, [visitIds]);
    await q(`delete from visit_reassignments where "visitId" = any($1)`, [visitIds]);
    await q(`delete from visit_delegations where "visitId" = any($1)`, [visitIds]);
    await q(`delete from visit_assignments where "visitId" = any($1)`, [visitIds]);
    await q(`delete from visits where id = any($1)`, [visitIds]);
  }
  if (userIds.length) {
    await q(`update subtasks set "carryForwardApprovedById"=null where "carryForwardApprovedById" = any($1)`, [userIds]);
    await q(`delete from activity_logs where "userId" = any($1)`, [userIds]);
    await q(`delete from admin_operations where "userId" = any($1) or "undoneById" = any($1)`, [userIds]);
    await q(`delete from attendance where "executiveId" = any($1)`, [userIds]);
    await q(`delete from leave_requests where "executiveId" = any($1) or "reviewedById" = any($1)`, [userIds]);
  }
  if (clientIds.length) {
    await q(`delete from subtask_templates where "clientId" = any($1)`, [clientIds]);
    await q(`delete from client_task_types where "clientId" = any($1)`, [clientIds]);
    await q(`delete from clients where id = any($1)`, [clientIds]);
  }
  if (userIds.length) await q(`delete from users where id = any($1)`, [userIds]);
}

// ── helpers used by the assertions ──────────────────────────────────────────
const pendingFor = async (adminToken, subtaskId) => {
  const r = await api("/api/admin/carry-forward/requests", adminToken);
  return (r.body.requests || []).find((x) => x.subtaskId === subtaskId) || null;
};
const popupFor = async (token, predicate) => {
  const r = await api("/api/carry-forward", token);
  return (r.body.carryForwards || []).filter(predicate);
};
const visitCount = async () => Number((await q(`select count(*)::int c from visits`))[0].c);
const clientVisitCount = async (clientId) =>
  Number((await q(`select count(*)::int c from visits where "clientId"=$1`, [clientId]))[0].c);
const subtaskRow = async (id) => (await q(`select * from subtasks where id=$1`, [id]))[0];
const orphans = async () => {
  const r = {};
  r.tasksNoVisit = Number((await q(`select count(*)::int c from tasks t left join visits v on v.id=t."visitId" where v.id is null`))[0].c);
  r.subtasksNoTask = Number((await q(`select count(*)::int c from subtasks s left join tasks t on t.id=s."taskId" where t.id is null`))[0].c);
  r.badSource = Number((await q(`select count(*)::int c from subtasks s where s."sourceSubtaskId" is not null and not exists (select 1 from subtasks p where p.id=s."sourceSubtaskId")`))[0].c);
  r.visitsNoClient = Number((await q(`select count(*)::int c from visits v left join clients c on c.id=v."clientId" where c.id is null`))[0].c);
  return r;
};

async function main() {
  await cleanup();

  const [admin] = await q(`select id,email,name,role from users where role='ADMIN' and "isActive" order by name limit 1`);
  if (!admin) throw new Error("No active ADMIN in the local database");
  admin.token = await tokenFor(admin);

  const execX = await mkUser("ExecX", "EXECUTIVE");
  const execY = await mkUser("ExecY", "EXECUTIVE");

  F.clientId = rid();
  await q(`insert into clients (id,name,code,"contactPerson",address,"reportEmails","isArchived","createdAt","updatedAt")
           values ($1,$2,$3,'Contact','Addr','{}',false,now(),now())`, [F.clientId, P + "Client", P + "C1"]);
  const otherClientId = rid();
  await q(`insert into clients (id,name,code,"contactPerson",address,"reportEmails","isArchived","createdAt","updatedAt")
           values ($1,$2,$3,'Contact','Addr','{}',false,now(),now())`, [otherClientId, P + "OtherClient", P + "C2"]);

  const yesterday = daysFromNow(-1);
  const target = daysFromNow(+3);
  const target2 = daysFromNow(+5);

  // ════════════════════════════════════════════════════════════════════════
  section("1. Executive closes a visit with an incomplete subtask");
  const v1 = await mkVisit({ clientId: F.clientId, executiveId: execX.id, status: "OPEN", date: yesterday, endDate: yesterday, number: "V1" });
  const t1 = await mkTask(v1, "STOCK_VERIFICATION", "Stock Verification");
  const sDone = await mkSubtask(t1, "Completed item", { isCompleted: true });
  const sOpen = await mkSubtask(t1, "Unfinished item");

  const closeNoReason = await api(`/api/visits/${v1}/close`, execX.token, { method: "POST", body: "{}" });
  eq(closeNoReason.status, 422, "closing is refused while an incomplete subtask has no reason");
  ok(/reason/i.test(JSON.stringify(closeNoReason.body)), "the refusal names the missing reason");

  await q(`update subtasks set "incompletionReason"=$2 where id=$1`, [sOpen, "Stock room was locked"]);
  const closed = await api(`/api/visits/${v1}/close`, execX.token, { method: "POST", body: "{}" });
  eq(closed.status, 200, "closing succeeds once the reason is supplied");
  eq((await q(`select status from visits where id=$1`, [v1]))[0].status, "CLOSED", "the visit is CLOSED");

  const after = await subtaskRow(sOpen);
  ok(after.carryForwardRequestedAt !== null, "the incomplete subtask is flagged as a PENDING request");
  eq(after.isCarriedForward, false, "it is NOT yet marked carried-forward");
  eq(after.carryForwardApprovedAt, null, "it is not approved");
  eq(after.carryForwardRejectedAt, null, "it is not rejected");
  eq((await subtaskRow(sDone)).carryForwardRequestedAt, null, "the COMPLETED subtask raised no request");
  eq(await clientVisitCount(F.clientId), 1, "closing created no new visit");
  eq(Number((await q(`select count(*)::int c from subtasks where "sourceSubtaskId"=$1`, [sOpen]))[0].c), 0, "closing copied nothing anywhere");

  // ════════════════════════════════════════════════════════════════════════
  section("2. The request reaches the Admin page with full context");
  const req = await pendingFor(admin.token, sOpen);
  ok(req !== null, "the item appears on Admin → Carry Forward");
  if (req) {
    eq(req.clientName, P + "Client", "  client name");
    eq(req.clientCode, P + "C1", "  client code");
    eq(req.executiveName, P + "ExecX", "  executive");
    eq(req.visitNumber, P + "V1", "  original visit number");
    eq(req.mainTask, "Stock Verification", "  main task");
    eq(req.subtaskTitle, "Unfinished item", "  subtask");
    eq(req.incompletionReason, "Stock room was locked", "  reason given by the executive");
    eq(new Date(req.originalDate).toISOString(), yesterday.toISOString(), "  original visit date");
    eq(req.visitStatus, "CLOSED", "  current status");
    eq(req.visitType, "SOLO", "  visit type");
    ok(req.requestedAt !== null, "  requested-at timestamp");
  }

  // ════════════════════════════════════════════════════════════════════════
  section("3. BEFORE approval the item is hidden from the executive");
  eq((await popupFor(execX.token, (x) => x.clientCode === P + "C1")).length, 0, "the owning executive's popup shows nothing");
  eq((await popupFor(execY.token, (x) => x.clientCode === P + "C1")).length, 0, "another executive's popup shows nothing");
  const xVisits = await api("/api/visits", execX.token);
  const carriedInList = JSON.stringify(xVisits.body).match(/\[CARRY-FORWARD\]/g) || [];
  eq(carriedInList.length, 0, "no carry-forward task appears in the executive's visit list");

  // ════════════════════════════════════════════════════════════════════════
  section("4. Admin REJECT");
  const rej = await api("/api/admin/carry-forward/requests", admin.token, {
    method: "POST", body: JSON.stringify({ subtaskIds: [sOpen], action: "reject" }),
  });
  eq(rej.status, 200, "reject is accepted");
  eq(rej.body.rejected, 1, "one request rejected");
  const rejected = await subtaskRow(sOpen);
  ok(rejected.carryForwardRejectedAt !== null, "the request is stamped rejected");
  eq(rejected.isCarriedForward, false, "it did NOT become a carry-forward task");
  eq(await pendingFor(admin.token, sOpen), null, "it no longer appears as pending for the admin");
  eq((await popupFor(execX.token, (x) => x.clientCode === P + "C1")).length, 0, "it does NOT appear in the executive popup");
  eq(await clientVisitCount(F.clientId), 1, "reject created no visit");
  eq((await q(`select status,"closedAt" is not null closed from visits where id=$1`, [v1]))[0].status, "CLOSED", "the original visit is unchanged");
  eq((await subtaskRow(sDone)).isCompleted, true, "the sibling completed subtask is untouched");
  eq(await orphans(), { tasksNoVisit: 0, subtasksNoTask: 0, badSource: 0, visitsNoClient: 0 }, "no orphan rows after reject");

  // ════════════════════════════════════════════════════════════════════════
  section("5. Admin APPROVE — reuses the client's existing visit on that date (§6)");
  const v2 = await mkVisit({ clientId: F.clientId, executiveId: execX.id, status: "OPEN", date: yesterday, endDate: yesterday, number: "V2" });
  const t2 = await mkTask(v2, "STOCK_VERIFICATION", "Stock Verification");
  const sOpen2 = await mkSubtask(t2, "Second unfinished item", { reason: "Ran out of time" });
  await api(`/api/visits/${v2}/close`, execX.token, { method: "POST", body: "{}" });
  ok((await subtaskRow(sOpen2)).carryForwardRequestedAt !== null, "second item is pending approval");

  // the executive ALREADY has a visit for this client on the target date
  const existing = await mkVisit({ clientId: F.clientId, executiveId: execX.id, status: "PENDING", date: target, endDate: target, number: "V3" });
  const existingTask = await mkTask(existing, "STOCK_VERIFICATION", "Stock Verification");
  const normalSub = await mkSubtask(existingTask, "Normal pre-existing work");

  const before = await visitCount();
  const appr = await api("/api/admin/carry-forward/requests", admin.token, {
    method: "POST",
    body: JSON.stringify({ subtaskIds: [sOpen2], destinationDate: target.toISOString(), assignment: { visitType: "SOLO", executiveId: execX.id } }),
  });
  eq(appr.status, 200, "approve is accepted");
  eq(appr.body.approved, 1, "one item approved");
  eq(appr.body.destinations?.[0]?.created, false, "NO new visit was created — the existing one was reused");
  eq(appr.body.destinations?.[0]?.visitId, existing, "the destination IS the pre-existing visit");
  eq(await visitCount(), before, "the total visit count did not change");
  eq(await clientVisitCount(F.clientId), 3, "the client still has exactly its 3 visits");

  const carried = (await q(
    `select s.* from subtasks s join tasks t on t.id=s."taskId" where t."visitId"=$1 and s."isCarriedForward"=true`, [existing]));
  eq(carried.length, 1, "exactly one carried subtask landed on the existing visit");
  eq(carried[0]?.sourceSubtaskId, sOpen2, "it points back at the original subtask");
  eq(carried[0]?.taskId, existingTask, "it joined the SAME main task, not a duplicate one");
  eq(Number((await q(`select count(*)::int c from tasks where "visitId"=$1`, [existing]))[0].c), 1, "no duplicate main task was created");
  eq((await subtaskRow(normalSub)).title, "Normal pre-existing work", "the visit's normal work is untouched");
  const src = await subtaskRow(sOpen2);
  ok(src.carryForwardApprovedAt !== null, "the original is stamped approved");
  eq(src.carryForwardApprovedById, admin.id, "  by the approving admin");
  eq(src.isCompleted, false, "the original subtask's own state is unchanged");
  eq((await q(`select status from visits where id=$1`, [v2]))[0].status, "CLOSED", "the original closed visit is unchanged");
  eq((await q(`select "scheduledDate" from visits where id=$1`, [existing]))[0].scheduledDate.toISOString(), target.toISOString(), "the destination date is respected");
  eq((await q(`select "executiveId" from visits where id=$1`, [existing]))[0].executiveId, execX.id, "the selected executive is respected");

  section("6. AFTER approval the executive sees it — and only the right one");
  const xPopup = await popupFor(execX.token, (x) => x.clientCode === P + "C1");
  eq(xPopup.length, 1, "the selected executive sees exactly one carry-forward item");
  eq(xPopup[0]?.subtaskTitle, "Second unfinished item", "  it is the approved item");
  eq(xPopup[0]?.originalVisitNumber, P + "V2", "  it shows the visit it came from");
  eq((await popupFor(execY.token, (x) => x.clientCode === P + "C1")).length, 0, "the other executive sees nothing");
  eq((await popupFor(execX.token, (x) => x.subtaskTitle === "Unfinished item")).length, 0, "the REJECTED item still never appears");

  section("7. Approving the same item twice creates no duplicate");
  const again = await api("/api/admin/carry-forward/requests", admin.token, {
    method: "POST", body: JSON.stringify({ subtaskIds: [sOpen2], destinationDate: target.toISOString() }),
  });
  eq(again.body.approved, 0, "the second approval approves nothing");
  eq(again.body.skipped, 1, "it is skipped as already approved");
  eq(Number((await q(`select count(*)::int c from subtasks where "sourceSubtaskId"=$1`, [sOpen2]))[0].c), 1, "still exactly one carried copy");
  eq(await visitCount(), before, "still no extra visit");

  // ════════════════════════════════════════════════════════════════════════
  section("8. Approve when NO visit exists for that date");
  const v4 = await mkVisit({ clientId: F.clientId, executiveId: execX.id, status: "OPEN", date: yesterday, endDate: yesterday, number: "V4" });
  const t4 = await mkTask(v4, "AVF_REPORT", "AVF Report");
  const sOpen3 = await mkSubtask(t4, "Third unfinished item", { reason: "Awaiting documents" });
  await api(`/api/visits/${v4}/close`, execX.token, { method: "POST", body: "{}" });

  const beforeNew = await visitCount();
  const apprNew = await api("/api/admin/carry-forward/requests", admin.token, {
    method: "POST",
    body: JSON.stringify({ subtaskIds: [sOpen3], destinationDate: target2.toISOString(), assignment: { visitType: "SOLO", executiveId: execY.id } }),
  });
  eq(apprNew.status, 200, "approve accepted");
  eq(apprNew.body.destinations?.[0]?.created, true, "a visit WAS created because none existed for that date");
  eq(await visitCount(), beforeNew + 1, "exactly one visit was created");
  const newVisit = (await q(`select * from visits where id=$1`, [apprNew.body.destinations[0].visitId]))[0];
  eq(newVisit.scheduledDate.toISOString(), target2.toISOString(), "the chosen date is respected");
  eq(newVisit.executiveId, execY.id, "the chosen executive is respected (re-assigned away from ExecX)");
  eq((await popupFor(execY.token, (x) => x.subtaskTitle === "Third unfinished item")).length, 1, "ExecY now sees it");
  eq((await popupFor(execX.token, (x) => x.subtaskTitle === "Third unfinished item")).length, 0, "ExecX does not");

  // ════════════════════════════════════════════════════════════════════════
  section("9. Executive re-dates a carry-forward item from the popup");
  const carriedId = (await popupFor(execY.token, (x) => x.subtaskTitle === "Third unfinished item"))[0].subtaskId;
  const beforeMove = await visitCount();

  const noop = await api("/api/carry-forward", execY.token, {
    method: "PATCH", body: JSON.stringify({ subtaskId: carriedId, date: target2.toISOString() }),
  });
  eq(noop.body.unchanged, true, "re-picking the same date is a no-op");
  eq(await visitCount(), beforeMove, "  and creates no visit");

  const target3 = daysFromNow(+9);
  const moved = await api("/api/carry-forward", execY.token, {
    method: "PATCH", body: JSON.stringify({ subtaskId: carriedId, date: target3.toISOString() }),
  });
  eq(moved.status, 200, "the date change is accepted");
  const movedVisit = (await q(`select v.* from visits v join tasks t on t."visitId"=v.id join subtasks s on s."taskId"=t.id where s.id=$1`, [carriedId]))[0];
  eq(movedVisit.scheduledDate.toISOString(), target3.toISOString(), "the new date is persisted and the task follows it");
  eq(await visitCount(), beforeMove, "no duplicate visit was created");
  eq((await q(`select status from visits where id=$1`, [v4]))[0].status, "CLOSED", "the original closed visit is unchanged");
  eq((await q(`select "scheduledDate" from visits where id=$1`, [existing]))[0].scheduledDate.toISOString(), target.toISOString(),
    "the OTHER visit for the same client is unchanged");
  eq((await subtaskRow(normalSub)).title, "Normal pre-existing work", "unrelated work on that visit is unchanged");

  section("10a. Re-dating onto a day only ANOTHER executive holds must not touch that visit");
  // `existing` (on `target`) belongs to ExecX; the carried item belongs to ExecY.
  const existingBefore = (await q(
    `select v."executiveId", count(s.id)::int subtasks from visits v
     left join tasks t on t."visitId"=v.id left join subtasks s on s."taskId"=t.id
     where v.id=$1 group by 1`, [existing]))[0];
  const crossMove = await api("/api/carry-forward", execY.token, {
    method: "PATCH", body: JSON.stringify({ subtaskId: carriedId, date: target.toISOString() }),
  });
  eq(crossMove.status, 200, "the re-date is accepted");
  ok(crossMove.body.visitId !== existing, "it did NOT move into the other executive's visit");
  const existingAfter = (await q(
    `select v."executiveId", count(s.id)::int subtasks from visits v
     left join tasks t on t."visitId"=v.id left join subtasks s on s."taskId"=t.id
     where v.id=$1 group by 1`, [existing]))[0];
  eq(existingAfter.executiveId, existingBefore.executiveId, "the other executive's visit keeps its owner");
  eq(existingAfter.subtasks, existingBefore.subtasks, "the other executive's visit gained no subtask");
  eq((await subtaskRow(normalSub)).title, "Normal pre-existing work", "its normal work is untouched");
  const stillY = (await q(
    `select v."executiveId" from visits v join tasks t on t."visitId"=v.id join subtasks s on s."taskId"=t.id where s.id=$1`,
    [carriedId]))[0];
  eq(stillY.executiveId, execY.id, "the item stayed with the executive it belongs to");

  section("10b. Re-dating onto a day the SAME executive already has reuses that visit");
  const target5 = daysFromNow(+15);
  const yOwn = await mkVisit({ clientId: F.clientId, executiveId: execY.id, status: "PENDING", date: target5, endDate: target5, number: "V8" });
  const yOwnTask = await mkTask(yOwn, "AVF_REPORT", "AVF Report");
  const yOwnNormal = await mkSubtask(yOwnTask, "ExecY normal work");
  const beforeReuse = await visitCount();
  const reused = await api("/api/carry-forward", execY.token, {
    method: "PATCH", body: JSON.stringify({ subtaskId: carriedId, date: target5.toISOString() }),
  });
  eq(reused.body.movedToExistingVisit, true, "it moved INTO the executive's own existing visit");
  eq(reused.body.visitId, yOwn, "  that visit");
  ok((await visitCount()) <= beforeReuse, "no duplicate visit was created");
  eq(Number((await q(`select count(*)::int c from tasks where "visitId"=$1`, [yOwn]))[0].c), 1, "it joined the existing AVF task, no duplicate task");
  eq((await subtaskRow(yOwnNormal)).title, "ExecY normal work", "that visit's normal work is untouched");

  // ════════════════════════════════════════════════════════════════════════
  section("11. Automatic carry-forward stays disabled");
  const beforeSweep = { visits: await visitCount(), carried: Number((await q(`select count(*)::int c from subtasks where "isCarriedForward"`))[0].c) };
  for (let i = 0; i < 6; i++) {
    await api("/api/calendar?start=" + daysFromNow(-30).toISOString() + "&end=" + daysFromNow(30).toISOString(), admin.token);
    await api("/api/admin/stats", admin.token);
    await api("/api/admin/carry-forward", admin.token);
    await api("/api/admin/carry-forward/requests", admin.token);
  }
  eq(await visitCount(), beforeSweep.visits, "24 maintenance-triggering requests created no visit");
  eq(Number((await q(`select count(*)::int c from subtasks where "isCarriedForward"`))[0].c), beforeSweep.carried,
    "and created no carried subtask");

  // ════════════════════════════════════════════════════════════════════════
  section("12. Visit delete still scoped correctly with carry-forward present");
  const delVisit = await mkVisit({ clientId: otherClientId, executiveId: execX.id, status: "PENDING", date: target, endDate: target, number: "V5" });
  const delTask = await mkTask(delVisit, "STOCK_VERIFICATION", "Stock Verification");
  await mkSubtask(delTask, "Work on the doomed visit");
  const beforeDel = { visits: await visitCount(), clientVisits: await clientVisitCount(F.clientId) };
  const del = await api(`/api/admin/visits/${delVisit}`, admin.token, { method: "DELETE" });
  eq(del.status, 200, "the visit deletes");
  eq(await visitCount(), beforeDel.visits - 1, "exactly one visit was removed");
  eq(await clientVisitCount(F.clientId), beforeDel.clientVisits, "the OTHER client's visits are untouched");
  eq(Number((await q(`select count(*)::int c from clients where id=$1`, [otherClientId]))[0].c), 1, "the client itself survives");
  eq(Number((await q(`select count(*)::int c from subtasks s join tasks t on t.id=s."taskId" where t."visitId"=$1 and s."isCarriedForward"`, [existing]))[0].c),
    1, "unrelated carry-forward tasks are unaffected");
  eq(await orphans(), { tasksNoVisit: 0, subtasksNoTask: 0, badSource: 0, visitsNoClient: 0 }, "no orphan rows after delete");

  // ════════════════════════════════════════════════════════════════════════
  section("13. Authorisation");
  const execReq = await api("/api/admin/carry-forward/requests", execX.token);
  eq(execReq.status, 403, "an executive cannot read the admin carry-forward queue");
  const execAppr = await api("/api/admin/carry-forward/requests", execX.token, {
    method: "POST", body: JSON.stringify({ subtaskIds: [sOpen3], destinationDate: target.toISOString() }),
  });
  eq(execAppr.status, 403, "an executive cannot approve");
  const anon = await fetch(`${BASE}/api/admin/carry-forward/requests`, { redirect: "manual" });
  ok(anon.status === 401 || anon.status === 307, `an unauthenticated request is refused (${anon.status})`);
  // `carriedId` now lives on ExecX's visit (it was moved there in §10), so
  // ExecX is its legitimate owner. Use an unrelated executive instead.
  const execZ = await mkUser("ExecZ", "EXECUTIVE");
  const foreign = await api("/api/carry-forward", execZ.token, {
    method: "PATCH", body: JSON.stringify({ subtaskId: carriedId, date: target2.toISOString() }),
  });
  eq(foreign.status, 403, "an unrelated executive cannot re-date someone else's carry-forward");
  eq((await popupFor(execZ.token, () => true)).length, 0, "an unrelated executive's popup is empty");

  // ════════════════════════════════════════════════════════════════════════
  section("14. Approving onto a date where ANOTHER executive holds the client's visit");
  const v6 = await mkVisit({ clientId: otherClientId, executiveId: execX.id, status: "OPEN", date: yesterday, endDate: yesterday, number: "V6" });
  const t6 = await mkTask(v6, "STOCK_VERIFICATION", "Stock Verification");
  const sOpen4 = await mkSubtask(t6, "ExecX unfinished item", { reason: "Blocked" });
  await api(`/api/visits/${v6}/close`, execX.token, { method: "POST", body: "{}" });

  // ExecY already owns a visit for THAT SAME client on the destination date,
  // holding the client's ordinary (non-carry-forward) work.
  const target4 = daysFromNow(+12);
  const yVisit = await mkVisit({ clientId: otherClientId, executiveId: execY.id, status: "PENDING", date: target4, endDate: target4, number: "V7" });
  const yTask = await mkTask(yVisit, "ACCOUNTS_VERIFICATION", "Accounts Verification");
  const yNormal = await mkSubtask(yTask, "ExecY's own normal work");

  const beforeCross = await visitCount();
  const cross = await api("/api/admin/carry-forward/requests", admin.token, {
    method: "POST",
    body: JSON.stringify({ subtaskIds: [sOpen4], destinationDate: target4.toISOString(), assignment: { visitType: "SOLO", executiveId: execX.id } }),
  });
  eq(cross.status, 200, "approve is accepted");

  const yAfter = (await q(`select "executiveId","visitType" from visits where id=$1`, [yVisit]))[0];
  eq(yAfter.executiveId, execY.id, "ExecY's existing visit is STILL owned by ExecY (not silently reassigned)");
  eq((await subtaskRow(yNormal)).title, "ExecY's own normal work", "ExecY's normal work is untouched");
  const execXSees = await popupFor(execX.token, (x) => x.subtaskTitle === "ExecX unfinished item");
  eq(execXSees.length, 1, "the approved item reaches the executive the admin selected (ExecX)");
  const execYSees = await popupFor(execY.token, (x) => x.subtaskTitle === "ExecX unfinished item");
  eq(execYSees.length, 0, "it does NOT land in ExecY's queue");
  ok((await visitCount()) >= beforeCross, "visit accounting is consistent");
  eq(await orphans(), { tasksNoVisit: 0, subtasksNoTask: 0, badSource: 0, visitsNoClient: 0 }, "no orphan rows");
}

const t0 = Date.now();
main()
  .catch((e) => { fail++; console.error("\nERROR:", e.message); })
  .finally(async () => {
    await cleanup();
    const left = (await q(`select count(*)::int c from users where name like $1`, [P + "%"]))[0].c
      + (await q(`select count(*)::int c from clients where code like $1`, [P + "%"]))[0].c
      + (await q(`select count(*)::int c from visits where "visitNumber" like $1`, [P + "%"]))[0].c;
    eq(Number(left), 0, "the test left no data behind");
    console.log(`\n=== ${pass} passed, ${fail} failed  (${Date.now() - t0}ms) ===`);
    await pool.end();
    process.exit(fail ? 1 : 0);
  });
