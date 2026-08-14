import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { prisma } from "@/lib/db/prisma";
import { toMidnightIST } from "@/lib/utils/attendance";

// ─── POST /api/attendance/punch-out ────────────────────────────────────────
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "EXECUTIVE") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const now = new Date();
    const today = toMidnightIST(now);

    // Punch-out now requires a reason. The executive confirms in a modal and
    // the note travels WITH this request, so a punch-out can never be recorded
    // without one. Enforced here, not only in the UI.
    const body = await request.json().catch(() => ({} as { notes?: string }));
    const notes = typeof body?.notes === "string" ? body.notes.trim() : "";
    if (!notes) {
      return NextResponse.json(
        { error: "A note is required to punch out. Please enter a reason." },
        { status: 400 }
      );
    }

    const existing = await prisma.attendance.findUnique({
      where: { executiveId_date: { executiveId: user.userId, date: today } },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "You have not punched in today" },
        { status: 400 }
      );
    }
    // ONE punch-out per day — unchanged.
    if (existing.punchOut) {
      return NextResponse.json(
        { error: "Already punched out for today" },
        { status: 409 }
      );
    }

    const workingMinutes = Math.round(
      (now.getTime() - new Date(existing.punchIn).getTime()) / 60000
    );

    // Punch-out time, working duration and the mandatory note are saved in the
    // same write, so the admin attendance view (which already reads
    // Attendance.notes) shows the reason with no second notification system.
    const updated = await prisma.attendance.update({
      where: { id: existing.id },
      data: { punchOut: now, workingMinutes, notes },
    });

    return NextResponse.json({ attendance: updated });
  } catch (error) {
    console.error("Punch-out error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
