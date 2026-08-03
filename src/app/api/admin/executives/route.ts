import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/middleware";
import { isAdminRole } from "@/lib/auth/roles";
import { getSubtaskTotals } from "@/lib/utils/visit-status";
import bcrypt from "bcryptjs";

// ─── GET /api/admin/executives ────────────────────────────────────────────────
// Optimized: use aggregated counts via groupBy instead of loading full task/subtask data

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || !isAdminRole(user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    // Fetch executives with only the minimal relations needed
    const executives = await prisma.user.findMany({
      where: { role: "EXECUTIVE" },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        isActive: true,
        createdAt: true,
        assignedClients: { select: { id: true, name: true } },
        assignedVisits: {
          select: {
            id: true,
            status: true,
            scheduledDate: true,
            client: { select: { id: true, name: true } },
            tasks: {
              select: {
                subtasks: {
                  select: { isCompleted: true, isCarriedForward: true },
                },
              },
            },
          },
        },
      },
      orderBy: { name: "asc" },
    });

    const now = new Date();

    const result = executives.map((exec: any) => {
      let pendingCount = 0;
      let inProgressCount = 0;
      let closedCount = 0;
      let missedCount = 0;
      const clientMap = new Map<string, { id: string; name: string }>();

      for (const visit of exec.assignedVisits) {
        // Build unique client set
        clientMap.set(visit.client.id, visit.client);

        // Compute status inline — no extra DB call — but through the SAME
        // shared helper every other screen uses. This used to derive status
        // from subtask progress alone and ignore visit.status, so a visit
        // formally closed at e.g. 83% was counted "in progress" here while
        // the dashboard, visit list and calendar all called it "closed".
        const { displayStatus } = getSubtaskTotals(visit.tasks, visit.status);

        if (displayStatus === "PENDING") pendingCount++;
        else if (displayStatus === "IN_PROGRESS") inProgressCount++;
        else closedCount++;

        // Missed = overdue visit not yet closed
        if (
          new Date(visit.scheduledDate ?? Date.now()) < now &&
          displayStatus !== "CLOSED"
        ) {
          missedCount++;
        }
      }

      return {
        id: exec.id,
        name: exec.name,
        email: exec.email,
        phone: exec.phone,
        isActive: exec.isActive,
        createdAt: exec.createdAt,
        totalVisits: exec.assignedVisits.length,
        pendingCount,
        inProgressCount,
        closedCount,
        missedCount,
        assignedClients: Array.from(clientMap.values()),
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
