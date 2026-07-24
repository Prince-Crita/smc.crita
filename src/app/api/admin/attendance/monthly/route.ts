import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { isAdminRole } from "@/lib/auth/roles";
import { prisma } from "@/lib/db/prisma";
import { toMidnightIST } from "@/lib/utils/attendance";

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
    const [yearStr, monthStr] = (monthParam || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`).split("-");
    const year = parseInt(yearStr, 10);
    const monthIndex = parseInt(monthStr, 10) - 1; // 0-based

    const monthStart = toMidnightIST(new Date(Date.UTC(year, monthIndex, 1, 12)));
    const nextMonthStart = toMidnightIST(new Date(Date.UTC(year, monthIndex + 1, 1, 12)));

    // Don't count days beyond today as "working days" for an in-progress month
    const todayIST = toMidnightIST(now);
    const effectiveEnd = nextMonthStart < todayIST ? nextMonthStart : new Date(todayIST.getTime() + 24 * 60 * 60 * 1000);
    const totalWorkingDays = Math.max(
      0,
      Math.round((effectiveEnd.getTime() - monthStart.getTime()) / (24 * 60 * 60 * 1000))
    );

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
      const execAttendance = attendanceRecords.filter((r) => r.executiveId === exec.id);
      const execLeave = leaveRecords.filter((r) => r.executiveId === exec.id);
      const presentCount = execAttendance.length;
      const lateCount = execAttendance.filter((r) => r.isLate).length;
      const leaveCount = execLeave.length;
      const absentCount = Math.max(0, totalWorkingDays - presentCount - leaveCount);
      const attendancePercentage = totalWorkingDays === 0 ? 0 : Math.round((presentCount / totalWorkingDays) * 100);

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
      status: "PRESENT" | "ABSENT" | "LEAVE";
      punchIn: string | null;
      punchOut: string | null;
      isLate: boolean;
    }[] = [];

    if (execId) {
      const leaveDateKeys = new Set(leaveRecords.map((r) => r.date.toISOString().slice(0, 10)));
      const attendanceByDate = new Map(attendanceRecords.map((r) => [r.date.toISOString().slice(0, 10), r]));

      for (let d = new Date(monthStart); d < effectiveEnd; d = new Date(d.getTime() + 24 * 60 * 60 * 1000)) {
        const key = d.toISOString().slice(0, 10);
        const rec = attendanceByDate.get(key);
        const onLeave = leaveDateKeys.has(key);
        daily.push({
          date: key,
          status: rec ? "PRESENT" : onLeave ? "LEAVE" : "ABSENT",
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
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
