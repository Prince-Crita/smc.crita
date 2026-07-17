import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { prisma } from "@/lib/db/prisma";
import { toMidnightIST } from "@/lib/utils/attendance";

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
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
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
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
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
        { status: 409 }
      );
    }

    // ── Late / On-Time (P7) ────────────────────────────────────────────────
    // The threshold is based on the executive's ASSIGNED VISIT TIME for the
    // day, not a fixed clock time: punching in within 30 minutes of the
    // earliest scheduled visit is On Time; more than 30 minutes after it is
    // Late. Previously a fixed 10:00 IST cutoff marked almost everyone Late
    // regardless of when their visit actually started.
    const dayEnd = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const firstVisit = await prisma.visit.findFirst({
      where: {
        executiveId: user.userId,
        scheduledDate: { gte: today, lt: dayEnd },
        status: { in: ["PENDING", "OPEN"] },
      },
      orderBy: { scheduledDate: "asc" },
      select: { scheduledDate: true },
    });

    const LATE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
    let isLate: boolean;
    if (firstVisit) {
      isLate = now.getTime() > firstVisit.scheduledDate.getTime() + LATE_THRESHOLD_MS;
    } else {
      // No visit assigned today - fall back to the office norm:
      // 10:00 IST + the same 30-minute grace (i.e. late after 10:30 IST).
      const minutesUTC = now.getUTCHours() * 60 + now.getUTCMinutes();
      isLate = minutesUTC > 4 * 60 + 30 + 30; // 10:30 IST = 05:00 UTC
    }

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
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
