import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { prisma } from "@/lib/db/prisma";

function toMidnightUTC(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

// ─── GET /api/leaves ── Executive: list own leave requests ────────────────
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);

  if (!user || user.role !== "EXECUTIVE") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const leaves = await prisma.leaveRequest.findMany({
      where: { executiveId: user.userId },
      orderBy: { date: "desc" },
    });

    // Also return visits for the next 14 days to show conflict warnings
    const now = new Date();
    const future = new Date();
    future.setDate(future.getDate() + 14);

    const upcomingVisits = await prisma.visit.findMany({
      where: {
        executiveId: user.userId,
        scheduledDate: { gte: now, lte: future },
        status: { not: "CLOSED" },
      },
      select: {
        id: true,
        visitNumber: true,
        scheduledDate: true,
        client: { select: { name: true } },
      },
      orderBy: { scheduledDate: "asc" },
    });

    return NextResponse.json({ leaves, upcomingVisits });
  } catch (error) {
    console.error("Leaves GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ─── POST /api/leaves ── Executive: apply for leave ────────────────────────
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);

  if (!user || user.role !== "EXECUTIVE") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = (await request.json()) as {
      date: string;
      reason: string;
      leaveType?: "FULL_DAY" | "HALF_DAY";
      halfDayPeriod?: "FIRST_HALF" | "SECOND_HALF";
    };

    const { date, reason } = body;
    const leaveType = body.leaveType ?? "FULL_DAY";
    const halfDayPeriod = body.halfDayPeriod ?? null;

    if (!date || !reason?.trim()) {
      return NextResponse.json(
        { error: "Date and reason are required" },
        { status: 400 },
      );
    }

    if (!["FULL_DAY", "HALF_DAY"].includes(leaveType)) {
      return NextResponse.json(
        { error: "Invalid leave type" },
        { status: 400 },
      );
    }

    if (
      leaveType === "HALF_DAY" &&
      !["FIRST_HALF", "SECOND_HALF"].includes(halfDayPeriod ?? "")
    ) {
      return NextResponse.json(
        { error: "Please select the first or second half" },
        { status: 400 },
      );
    }

    if (leaveType === "FULL_DAY" && halfDayPeriod !== null) {
      return NextResponse.json(
        { error: "Half-day period is only valid for half-day leave" },
        { status: 400 },
      );
    }

    const parsedDate = new Date(date);

    if (Number.isNaN(parsedDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid leave date" },
        { status: 400 },
      );
    }

    const leaveDate = toMidnightUTC(parsedDate);
    const today = toMidnightUTC(new Date());

    // Allow leave requests for today, but reject past dates.
    if (leaveDate < today) {
      return NextResponse.json(
        { error: "Leave date cannot be in the past" },
        { status: 400 },
      );
    }

    // Check for duplicate leave request on the same day
    const existing = await prisma.leaveRequest.findUnique({
      where: {
        executiveId_date: {
          executiveId: user.userId,
          date: leaveDate,
        },
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "A leave request already exists for this date" },
        { status: 409 },
      );
    }

    // Check for unresolved visits on that day that are not closed/reassigned
    const startOfDay = leaveDate;
    const endOfDay = new Date(leaveDate);
    endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);

    const visitsOnDay = await prisma.visit.findMany({
      where: {
        executiveId: user.userId,
        scheduledDate: { gte: startOfDay, lt: endOfDay },
        status: { not: "CLOSED" },
      },
      select: {
        id: true,
        visitNumber: true,
        client: { select: { name: true } },
      },
    });

    if (visitsOnDay.length > 0) {
      return NextResponse.json(
        {
          error:
            "You have scheduled visits on this date. Please reschedule or delegate them first.",
          visits: visitsOnDay,
          code: "VISITS_CONFLICT",
        },
        { status: 409 },
      );
    }

    const leave = await prisma.leaveRequest.create({
      data: {
        executiveId: user.userId,
        date: leaveDate,
        reason: reason.trim(),
        leaveType,
        halfDayPeriod,
      },
    });

    return NextResponse.json({ leave }, { status: 201 });
  } catch (error) {
    console.error("Leave POST error:", error);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
