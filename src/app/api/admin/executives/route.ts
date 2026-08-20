import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/middleware";
import { isAdminRole } from "@/lib/auth/roles";
import { getVisitSubtaskCounts, totalsForVisit } from "@/lib/utils/visit-aggregates";
import bcrypt from "bcryptjs";

// ─── GET /api/admin/executives ────────────────────────────────────────────────
// Returns one summary row per executive: their visit counts by display status,
// how many are overdue, and the clients they have visited.
//
// The counts are derived from per-visit COUNT aggregates (visit-aggregates.ts).
// This endpoint used to nest `assignedVisits → tasks → subtasks` inside the
// executive query, which loaded the ENTIRE subtask table — tens of thousands
// of rows — to produce a response of a few kilobytes, and did it again on
// every admin dashboard load (the dashboard fetches this alongside
// /api/admin/stats, which was loading the same rows a second time).
//
// The status arithmetic itself is unchanged: it still runs through the shared
// display-status helper, so an executive's counts cannot drift from what the
// dashboard, visit list and calendar show for the same visits.

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const [executives, visits, counts] = await Promise.all([
      prisma.user.findMany({
        where: { role: "EXECUTIVE" },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          isActive: true,
          createdAt: true,
          // NOTE: the response's `assignedClients` is the set of clients this
          // executive actually has visits for (built below), NOT the
          // Client.assignedExecId relation — unchanged from before, so the
          // relation is deliberately not selected here.
        },
        orderBy: { name: "asc" },
      }),
      // Owned visits only — this mirrors the previous `assignedVisits`
      // relation (User.assignedVisits = visits where executiveId = user.id),
      // so team-member rows keep being excluded exactly as before.
      prisma.visit.findMany({
        select: {
          id: true,
          executiveId: true,
          status: true,
          scheduledDate: true,
          client: { select: { id: true, name: true } },
        },
      }),
      getVisitSubtaskCounts(),
    ]);

    const now = new Date();

    interface ExecTally {
      pendingCount: number;
      inProgressCount: number;
      closedCount: number;
      missedCount: number;
      totalVisits: number;
      clients: Map<string, { id: string; name: string }>;
    }
    const tallies = new Map<string, ExecTally>();
    const tallyFor = (id: string): ExecTally => {
      let t = tallies.get(id);
      if (!t) {
        t = { pendingCount: 0, inProgressCount: 0, closedCount: 0, missedCount: 0, totalVisits: 0, clients: new Map() };
        tallies.set(id, t);
      }
      return t;
    };

    for (const visit of visits) {
      const t = tallyFor(visit.executiveId);
      t.totalVisits++;
      t.clients.set(visit.client.id, visit.client);

      const { displayStatus } = totalsForVisit(counts, visit.id, visit.status);
      if (displayStatus === "PENDING") t.pendingCount++;
      else if (displayStatus === "IN_PROGRESS") t.inProgressCount++;
      else t.closedCount++;

      // Missed = overdue visit not yet closed
      if (new Date(visit.scheduledDate ?? Date.now()) < now && displayStatus !== "CLOSED") {
        t.missedCount++;
      }
    }

    const result = executives.map((exec) => {
      const t = tallies.get(exec.id);
      return {
        id: exec.id,
        name: exec.name,
        email: exec.email,
        phone: exec.phone,
        isActive: exec.isActive,
        createdAt: exec.createdAt,
        totalVisits: t?.totalVisits ?? 0,
        pendingCount: t?.pendingCount ?? 0,
        inProgressCount: t?.inProgressCount ?? 0,
        closedCount: t?.closedCount ?? 0,
        missedCount: t?.missedCount ?? 0,
        assignedClients: t ? Array.from(t.clients.values()) : [],
      };
    });

    return NextResponse.json({ executives: result });
  } catch (error) {
    console.error("Get executives error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST /api/admin/executives ───────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await request.json();
    const { name, email, phone, password } = body;

    if (!name || name.trim().length < 2)
      return NextResponse.json({ error: "Name must be at least 2 characters" }, { status: 400 });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    if (!password || password.length < 8)
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists)
      return NextResponse.json({ error: "Email already registered" }, { status: 409 });

    const passwordHash = await bcrypt.hash(password, 12);
    const executive    = await prisma.user.create({
      data: {
        name:         name.trim(),
        email:        email.toLowerCase().trim(),
        phone:        phone || null,
        passwordHash,
        role:         "EXECUTIVE",
        isActive:     true,
      },
    });

    await prisma.activityLog.create({
      data: {
        userId:   user.userId,
        action:   "EXECUTIVE_ADDED",
        metadata: {
          executiveName:  executive.name,
          executiveEmail: executive.email,
          addedBy:        user.name,
        },
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash: _, ...safeExec } = executive;
    return NextResponse.json({ executive: safeExec }, { status: 201 });
  } catch (error) {
    console.error("Create executive error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
