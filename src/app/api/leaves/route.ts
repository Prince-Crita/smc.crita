import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { prisma } from "@/lib/db/prisma";

function toMidnightUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
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
      select: { id: true, visitNumber: true, scheduledDate: true, client: { select: { name: true } } },
      orderBy: { scheduledDate: "asc" },
    });

    return NextResponse.json({ leaves, upcomingVisits });
  } catch (error) {
    console.error("Leaves GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST /api/leaves ── Executive: apply for leave ────────────────────────
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "EXECUTIVE") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json() as { date: string; reason: string };
    const { date, reason } = body;

    if (!date || !reason?.trim()) {
      return NextResponse.json(
        { error: "Date and reason are required" },
        { status: 400 }
      );
    }

    const leaveDate = toMidnightUTC(new Date(date));
    const today = toMidnightUTC(new Date());

    if (leaveDate <= today) {
      return NextResponse.json(
        { error: "Leave date must be in the future" },
        { status: 400 }
      );
    }

    // Check for duplicate leave request on same day
    const existing = await prisma.leaveRequest.findUnique({
      where: { executiveId_date: { executiveId: user.userId, date: leaveDate } },
    });
    if (existing) {
      return NextResponse.json(
        { error: "A leave request already exists for this date" },
        { status: 409 }
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
      select: { id: true, visitNumber: true, client: { select: { name: true } } },
    });

    if (visitsOnDay.length > 0) {
      return NextResponse.json(
        {
          error: "You have scheduled visits on this date. Please reschedule or delegate them first.",
          visits: visitsOnDay,
          code: "VISITS_CONFLICT",
        },
        { status: 409 }
      );
    }

    const leave = await prisma.leaveRequest.create({
      data: {
        executiveId: user.userId,
        date: leaveDate,
        reason: reason.trim(),
      },
    });

    return NextResponse.json({ leave }, { status: 201 });
  } catch (error) {
    console.error("Leave POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
