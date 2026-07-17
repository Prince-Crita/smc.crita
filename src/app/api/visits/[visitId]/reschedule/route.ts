import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { prisma } from "@/lib/db/prisma";
import { getApprovedLeave } from "@/lib/utils/leave-check";
import {
  CARRY_FORWARD_NOTE_PREFIX,
  RESCHEDULED_FROM_NOTE_PREFIX,
} from "@/lib/utils/carry-forward";

// ─── POST /api/visits/[visitId]/reschedule ─── Admin (any visit) or the
// assigned Executive (their own visit only) ─────────────────────────────────
// Body: { date: string (ISO), reason?: string, carryForward?: boolean }
//
// carryForward (default FALSE):
//   false → the visit simply moves to the new date. The vacated week is
//           marked with a RESCHEDULED-FROM note so the missed-weekly check
//           never generates an incorrect carry-forward for it.
//   true  → the moved visit is additionally flagged as a Carry Forward visit
//           (CARRY_FORWARD note marker), so it appears on the Carry Forward
//           page, dashboards and stats with the carry-forward badge.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ visitId: string }> }
) {
  const user = await getAuthUser(request);
  if (!user || (user.role !== "ADMIN" && user.role !== "EXECUTIVE")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { visitId } = await params;

  try {
    const body = await request.json() as { date: string; reason?: string; carryForward?: boolean };
    const { date, reason } = body;
    const carryForward = body.carryForward === true; // default: No

    if (!date) {
      return NextResponse.json({ error: "date is required" }, { status: 400 });
    }

    const newDate = new Date(date);
    if (isNaN(newDate.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const visit = await prisma.visit.findUnique({ where: { id: visitId } });
    if (!visit) {
      return NextResponse.json({ error: "Visit not found" }, { status: 404 });
    }
    if (user.role === "EXECUTIVE" && visit.executiveId !== user.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (visit.status === "CLOSED") {
      return NextResponse.json({ error: "Cannot reschedule a closed visit" }, { status: 400 });
    }

    // Leave conflict check — block if executive has approved leave on the new date
    const leaveConflict = await getApprovedLeave(visit.executiveId, newDate);
    if (leaveConflict) {
      return NextResponse.json(
        {
          error: "Executive is on approved leave on this date. Please select another date or assign a different executive.",
          code: "LEAVE_CONFLICT",
        },
        { status: 409 }
      );
    }

    // Build the updated notes:
    //  - always record the vacated date (suppresses phantom missed-week CF)
    //  - optionally record the reason
    //  - when carryForward=Yes, add the CF marker so the visit is treated as
    //    a carry-forward visit everywhere (badge, CF page, counts)
    const noteLines: string[] = [];
    if (visit.notes) noteLines.push(visit.notes);
    noteLines.push(`${RESCHEDULED_FROM_NOTE_PREFIX} ${visit.scheduledDate.toISOString()}]`);
    if (reason) noteLines.push(`[Rescheduled: ${reason}]`);
    if (carryForward && !visit.notes?.includes(CARRY_FORWARD_NOTE_PREFIX)) {
      noteLines.push(
        `${CARRY_FORWARD_NOTE_PREFIX} Rescheduled from ${visit.scheduledDate.toISOString().split("T")[0]}]`
      );
    }

    const updated = await prisma.visit.update({
      where: { id: visitId },
      data: {
        scheduledDate: newDate,
        // The old working window no longer applies - reset so the end date
        // defaults to the new day (admin can set an explicit one later).
        endDate: null,
        notes: noteLines.join("\n"),
      },
    });

    await prisma.activityLog.create({
      data: {
        visitId,
        userId: user.userId,
        action: "VISIT_CREATED", // reusing closest action; VISIT_RESCHEDULED not in enum
        metadata: {
          action: "RESCHEDULED",
          newDate: newDate.toISOString(),
          reason: reason || null,
          by: user.name,
        },
      },
    });

    return NextResponse.json({ visit: updated });
  } catch (error) {
    console.error("Reschedule error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
