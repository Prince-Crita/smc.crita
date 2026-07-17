import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { prisma } from "@/lib/db/prisma";
import { toMidnightIST } from "@/lib/utils/attendance";

// ─── GET /api/admin/attendance ─────────────────────────────────────────────
// Query params: date (YYYY-MM-DD), executiveId
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get("date");
    const execId = searchParams.get("executiveId");

    // Build date range filter.
    //
    // CRITICAL: Attendance rows are keyed by IST midnight (see toMidnightIST
    // in src/lib/utils/attendance.ts - punch-in writes `date` as the UTC
    // instant of IST midnight, i.e. 18:30 UTC of the PREVIOUS day). Filtering
    // by raw UTC midnight here excluded every punch-in for the selected IST
    // day, so executives who had punched in still showed as "Absent" on the
    // admin attendance page. The filter must use the same IST day boundary
    // as the writes.
    let dateFilter: { gte: Date; lt: Date } | { gte: Date; lte: Date };
    if (dateParam) {
      // dateParam is YYYY-MM-DD (an IST calendar day). Parse it as UTC noon
      // first so toMidnightIST resolves to that same calendar day regardless
      // of server timezone, then take [IST midnight, next IST midnight).
      const start = toMidnightIST(new Date(`${dateParam}T12:00:00Z`));
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      dateFilter = { gte: start, lt: end };
    } else {
      // Default: last 7 IST days (inclusive of today)
      const end = new Date();
      const start = toMidnightIST(new Date());
      start.setUTCDate(start.getUTCDate() - 7);
      dateFilter = { gte: start, lte: end };
    }

    // Fetch attendance records
    const records = await prisma.attendance.findMany({
      where: {
        date: dateFilter,
        ...(execId ? { executiveId: execId } : {}),
      },
      include: {
        executive: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ date: "desc" }, { executive: { name: "asc" } }],
    });

    // Fetch all executives (to show absent ones too)
    const executives = await prisma.user.findMany({
      where: { role: "EXECUTIVE", isActive: true },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ records, executives });
  } catch (error) {
    console.error("Admin attendance GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
