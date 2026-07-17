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

    const existing = await prisma.attendance.findUnique({
      where: { executiveId_date: { executiveId: user.userId, date: today } },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "You have not punched in today" },
        { status: 400 }
      );
    }
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
      data: { punchOut: now, workingMinutes },
    });

    return NextResponse.json({ attendance: updated });
  } catch (error) {
    console.error("Punch-out error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
