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

    // Optional free-text note the executive types on punch-out (overtime,
    // travel delay, extra verification requested by the client, ...). Body may
    // be absent entirely — punch-out used to be sent with no body at all, and
    // that must keep working.
    const body = (await request.json().catch(() => ({}))) as { notes?: unknown };
    const notes =
      typeof body?.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 2000) : null;

    const existing = await prisma.attendance.findUnique({
      where: { executiveId_date: { executiveId: user.userId, date: today } },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "You have not punched in today" },
        { status: 400 }
      );
    }
    // ONE punch-out per day — unchanged. The note rides along with that single
    // punch-out, so there is exactly one note per attendance record.
    if (existing.punchOut) {
      return NextResponse.json(
        { error: "Already punched out for today" },
        { status: 409 }
      );
    }

    const workingMinutes = Math.round(
      (now.getTime() - new Date(existing.punchIn).getTime()) / 60000
    );

    const updated = await prisma.attendance.update({
      where: { id: existing.id },
      data: { punchOut: now, workingMinutes, ...(notes ? { notes } : {}) },
    });

    return NextResponse.json({ attendance: updated });
  } catch (error) {
    console.error("Punch-out error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
