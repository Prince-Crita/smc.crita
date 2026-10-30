import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { isAdminRole } from "@/lib/auth/roles";
import { prisma } from "@/lib/db/prisma";
import { toMidnightIST, istDateString } from "@/lib/utils/attendance";

const DAY_MS = 24 * 60 * 60 * 1000;

// Sunday is a non-working day (Phase 2, requirement 8). The weekday is read
// from the IST calendar date ("YYYY-MM-DD") itself. It must NOT be read with
// getUTCDay() from a toMidnightIST() value: that instant is 18:30 UTC of the
// PREVIOUS date, so its UTC weekday is one day behind (Monday would be taken
// for Sunday).
const isSundayIST = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay() === 0;

// ─── GET /api/admin/attendance/monthly ─────────────────────────────────────
// Query params: month (YYYY-MM, required), executiveId (optional)
//
// Returns a per-executive summary for the whole month, plus a day-by-day
// breakdown when a single executive is selected. Uses the same IST day
// boundary (toMidnightIST) as the daily attendance route/writes.
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const monthParam = searchParams.get("month"); // YYYY-MM
    const execId = searchParams.get("executiveId");

    const now = new Date();
    const [yearStr, monthStr] = (
      monthParam ||
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
    ).split("-");
    const year = parseInt(yearStr, 10);
    const monthIndex = parseInt(monthStr, 10) - 1; // 0-based

    const monthStart = toMidnightIST(
      new Date(Date.UTC(year, monthIndex, 1, 12)),
    );
    const nextMonthStart = toMidnightIST(
      new Date(Date.UTC(year, monthIndex + 1, 1, 12)),
    );

    // Don't count days beyond today as "working days" for an in-progress month
    const todayIST = toMidnightIST(now);
    const effectiveEnd =
      nextMonthStart < todayIST
        ? nextMonthStart
        : new Date(todayIST.getTime() + 24 * 60 * 60 * 1000);

    // Every IST calendar day of the month up to today, as "YYYY-MM-DD".
    // Attendance rows (IST midnight) and leave rows (UTC midnight) both map
    // onto these keys through istDateString, so each lands on its own day.
    const days: string[] = [];
    for (let d = new Date(monthStart); d < effectiveEnd; d = new Date(d.getTime() + DAY_MS)) {
      days.push(istDateString(d));
    }
    const workingDays = days.filter((d) => !isSundayIST(d));
    const totalWorkingDays = workingDays.length;

    const executives = await prisma.user.findMany({
      where: { role: "EXECUTIVE", ...(execId ? { id: execId } : {}) },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    });

    const [attendanceRecords, leaveRecords] = await Promise.all([
      prisma.attendance.findMany({
        where: {
          date: { gte: monthStart, lt: nextMonthStart },
          ...(execId ? { executiveId: execId } : {}),
        },
        orderBy: { date: "asc" },
      }),
      prisma.leaveRequest.findMany({
        where: {
          date: { gte: monthStart, lt: nextMonthStart },
          status: "APPROVED",
          ...(execId ? { executiveId: execId } : {}),
        },
      }),
    ]);

    const summary = executives.map((exec) => {
      const execAttendance = attendanceRecords.filter(
        (r) => r.executiveId === exec.id,
      );
      const execLeave = leaveRecords.filter((r) => r.executiveId === exec.id);
      const presentCount = execAttendance.length;
      const lateCount = execAttendance.filter((r) => r.isLate).length;
      const leaveCount = execLeave.length;
      // Absent = a WORKING day with neither a punch-in nor an approved leave,
      // decided day by day. Subtracting totals instead let a Sunday punch-in,
      // or a half-day leave on a day the executive also punched in, cancel
      // out a real absence elsewhere in the month.
      const presentDays = new Set(execAttendance.map((r) => istDateString(r.date)));
      const leaveDays = new Set(execLeave.map((r) => istDateString(r.date)));
      const absentCount = workingDays.filter((d) => !presentDays.has(d) && !leaveDays.has(d)).length;
      const presentOnWorkingDays = workingDays.filter((d) => presentDays.has(d)).length;
      const attendancePercentage =
        totalWorkingDays === 0
          ? 0
          : Math.round((presentOnWorkingDays / totalWorkingDays) * 100);

      return {
        executiveId: exec.id,
        executiveName: exec.name,
        executiveEmail: exec.email,
        presentCount,
        absentCount,
        leaveCount,
        lateCount,
        totalWorkingDays,
        attendancePercentage,
      };
    });

    // Day-by-day breakdown — only meaningful when a single executive is selected
    const daily: {
      date: string;
      status: "PRESENT" | "ABSENT" | "LEAVE" | "SUNDAY";
      punchIn: string | null;
      punchOut: string | null;
      isLate: boolean;
    }[] = [];

    if (execId) {
      const leaveDateKeys = new Set(
        leaveRecords.map((r) => istDateString(r.date)),
      );
      const attendanceByDate = new Map(
        attendanceRecords.map((r) => [istDateString(r.date), r]),
      );

      for (const key of days) {
        const rec = attendanceByDate.get(key);
        const onLeave = leaveDateKeys.has(key);
        daily.push({
          date: key,
          // A Sunday is never Absent; a punch-in or leave on it still shows.
          status: rec ? "PRESENT" : onLeave ? "LEAVE" : isSundayIST(key) ? "SUNDAY" : "ABSENT",
          punchIn: rec?.punchIn.toISOString() ?? null,
          punchOut: rec?.punchOut?.toISOString() ?? null,
          isLate: rec?.isLate ?? false,
        });
      }
    }

    return NextResponse.json({
      month: `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
      executives,
      summary,
      daily,
    });
  } catch (error) {
    console.error("Admin monthly attendance GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
