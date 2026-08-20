import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { isAdminRole } from "@/lib/auth/roles";
import { prisma } from "@/lib/db/prisma";
import {
  approveCarryForward,
  hasEndDatePassed,
  rejectCarryForward,
  runCarryForwardMaintenance,
} from "@/lib/utils/carry-forward";
import { normalizeAssignment } from "@/lib/utils/visit-assignment";

// ─── GET /api/admin/carry-forward/requests ───────────────────────────────────
// Carry-forward items AWAITING ADMIN APPROVAL (§7). These are incomplete
// subtasks on finished visits; nothing has been copied anywhere yet.
//
// Each row carries everything the admin needs to decide: client, executive,
// original visit + date, main task, subtask, and the visit's current date.
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // Refresh the pending set (marks newly-due items). Creates nothing.
    await runCarryForwardMaintenance();

    const pending = await prisma.subtask.findMany({
      where: {
        isCompleted: false,
        isCarriedForward: false,
        carryForwardRequestedAt: { not: null },
        carryForwardApprovedAt: null,
        carryForwardRejectedAt: null,
      },
      select: {
        id: true,
        title: true,
        incompletionReason: true,
        carryForwardRequestedAt: true,
        task: {
          select: {
            id: true,
            title: true,
            taskType: true,
            visit: {
              select: {
                id: true,
                visitNumber: true,
                scheduledDate: true,
                endDate: true,
                status: true,
                // §5 — the assignment the work came from, so the admin sees
                // the previous executive/team and can keep or change it.
                visitType: true,
                client: { select: { id: true, name: true, code: true } },
                executive: { select: { id: true, name: true } },
                assignments: {
                  select: { role: true, executive: { select: { id: true, name: true } } },
                },
              },
            },
          },
        },
      },
      // `id` breaks ties: these rows are written in batches (a visit's
      // subtasks are scaffolded together, and carry-forward requests are
      // flagged in a single updateMany), so many share an identical
      // timestamp. Without a tiebreaker Postgres may return them in a
      // different order on each request and the list reshuffles itself.
      orderBy: [{ carryForwardRequestedAt: "asc" }, { id: "asc" }],
    });

    // §6 — a task is only awaiting approval once its visit's LAST WORKING DAY
    // is completely over (end of that IST calendar day). The flag alone is not
    // enough: rows flagged before this rule was corrected, and rows whose
    // visit was later rescheduled into the future, are still marked in the
    // database. Re-checking the window on read means such a row can never be
    // presented as due, and the admin is never asked to carry forward work the
    // executive still has time to finish.
    const now = new Date();
    const due = pending.filter((s) => hasEndDatePassed(s.task.visit, now));

    const items = due.map((s) => ({
      subtaskId: s.id,
      subtaskTitle: s.title,
      incompletionReason: s.incompletionReason,
      requestedAt: s.carryForwardRequestedAt,
      taskId: s.task.id,
      mainTask: s.task.title,
      taskType: s.task.taskType,
      visitId: s.task.visit.id,
      visitNumber: s.task.visit.visitNumber,
      originalDate: s.task.visit.scheduledDate,
      currentScheduledDate: s.task.visit.endDate ?? s.task.visit.scheduledDate,
      visitStatus: s.task.visit.status,
      clientId: s.task.visit.client.id,
      clientName: s.task.visit.client.name,
      clientCode: s.task.visit.client.code,
      // Previous assignment (§5): the executive who handled the visit, plus
      // the full team when it was a Team Visit.
      executiveId: s.task.visit.executive.id,
      executiveName: s.task.visit.executive.name,
      visitType: s.task.visit.visitType,
      teamMembers: s.task.visit.assignments
        .filter((a) => a.role !== "LEAD")
        .map((a) => ({ id: a.executive.id, name: a.executive.name })),
    }));

    return NextResponse.json({ requests: items, total: items.length });
  } catch (error) {
    console.error("Carry-forward requests error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST /api/admin/carry-forward/requests ──────────────────────────────────
// Approve or reject selected carry-forward requests.
// Body: { subtaskIds: string[], destinationDate?: string, action?: "approve" | "reject" }
//
// Approving places the items on `destinationDate`, adding them to the client's
// EXISTING visit for that date when there is one (§8) rather than creating a
// duplicate visit.
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({})) as {
      subtaskIds?: string[];
      destinationDate?: string;
      action?: "approve" | "reject";
      /** §5 — optional re-assignment applied to the destination visit. */
      assignment?: { visitType?: "SOLO" | "TEAM"; executiveId?: string; memberIds?: string[] };
    };

    const subtaskIds = Array.isArray(body.subtaskIds) ? body.subtaskIds.filter(Boolean) : [];
    if (subtaskIds.length === 0) {
      return NextResponse.json({ error: "Select at least one carry-forward task." }, { status: 400 });
    }

    if (body.action === "reject") {
      const { rejected } = await rejectCarryForward(subtaskIds);
      return NextResponse.json({ success: true, rejected });
    }

    if (!body.destinationDate) {
      return NextResponse.json({ error: "A destination date is required to approve carry-forward." }, { status: 400 });
    }
    const destination = new Date(body.destinationDate);
    if (isNaN(destination.getTime())) {
      return NextResponse.json({ error: "Invalid destination date." }, { status: 400 });
    }

    // Validated before anything is approved, through the same normalizer the
    // rest of the app uses — so "Team with no members" is rejected here rather
    // than half-applied.
    let assignment;
    if (body.assignment) {
      const normalized = normalizeAssignment(body.assignment);
      if (normalized.error) return NextResponse.json({ error: normalized.error }, { status: 400 });
      assignment = normalized.value;
    }

    const result = await approveCarryForward(subtaskIds, destination, user.userId, { assignment });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Carry-forward approval error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
