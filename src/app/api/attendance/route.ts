import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { prisma } from "@/lib/db/prisma";
import { toMidnightIST, isLatePunchIn } from "@/lib/utils/attendance";

// ─── GET /api/attendance ────────────────────────────────────────────────────
// Returns: today's record, last 30 days history, punch streak
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "EXECUTIVE") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const today = toMidnightIST(new Date());
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [todayRecord, history] = await Promise.all([
      prisma.attendance.findUnique({
        where: { executiveId_date: { executiveId: user.userId, date: today } },
      }),
      prisma.attendance.findMany({
        where: {
          executiveId: user.userId,
          date: { gte: thirtyDaysAgo },
        },
        orderBy: { date: "desc" },
        take: 30,
      }),
    ]);

    // Calculate consecutive punch-in streak
    let streak = 0;
    const sortedHistory = [...history].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    const checkDate = new Date(today);
    for (const record of sortedHistory) {
      const recDate = toMidnightIST(new Date(record.date));
      if (recDate.getTime() === checkDate.getTime()) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }

    return NextResponse.json({ today: todayRecord, history, streak });
  } catch (error) {
    console.error("Attendance GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ─── POST /api/attendance ─── Punch In ─────────────────────────────────────
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "EXECUTIVE") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const now = new Date();
    const today = toMidnightIST(now);

    // Prevent duplicate punch-in
    const existing = await prisma.attendance.findUnique({
      where: { executiveId_date: { executiveId: user.userId, date: today } },
    });
    if (existing) {
      return NextResponse.json(
        { error: "Already punched in for today" },
        { status: 409 },
      );
    }

    // ── Late / On-Time (Phase 2, requirement 9) ────────────────────────────
    // Fixed working-time rule, in IST: a punch-in up to 7:30 PM is On Time,
    // after 7:30 PM is Late. Stored once at punch-in; every screen shows it.
    const isLate = isLatePunchIn(now);

    const record = await prisma.attendance.create({
      data: {
        executiveId: user.userId,
        date: today,
        punchIn: now,
        isLate,
      },
    });

    return NextResponse.json({ attendance: record }, { status: 201 });
  } catch (error) {
    console.error("Punch-in error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ─── PATCH /api/attendance ─── Submit today's punch-out note ────────────────
// Separate from punch-out itself: the executive punches out immediately, then
// optionally sends a note from the inline Notes section that appears
// afterwards. Attendance business logic is untouched — this only fills in the
// `notes` column that already exists on the Attendance model.
export async function PATCH(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "EXECUTIVE") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      notes?: unknown;
    };
    const notes =
      typeof body.notes === "string" && body.notes.trim()
        ? body.notes.trim().slice(0, 2000)
        : "";

    if (!notes) {
      return NextResponse.json(
        { error: "Note cannot be empty" },
        { status: 400 },
      );
    }

    const today = toMidnightIST(new Date());
    const existing = await prisma.attendance.findUnique({
      where: { executiveId_date: { executiveId: user.userId, date: today } },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "You have not punched in today" },
        { status: 400 },
      );
    }
    // The note describes the day that just ended, so it belongs to a completed
    // punch-out.
    if (!existing.punchOut) {
      return NextResponse.json(
        { error: "Punch out first, then add your note" },
        { status: 400 },
      );
    }
    // One note per attendance record — a second submission is rejected rather
    // than silently overwriting the first.
    if (existing.notes) {
      return NextResponse.json(
        {
          error: "A note has already been submitted for today",
          code: "NOTE_EXISTS",
        },
        { status: 409 },
      );
    }

    const updated = await prisma.attendance.update({
      where: { id: existing.id },
      data: { notes },
    });

    return NextResponse.json({ attendance: updated });
  } catch (error) {
    console.error("Attendance note error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
