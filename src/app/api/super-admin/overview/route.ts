import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireSuperAdmin } from "@/lib/utils/super-admin";
import { toMidnightIST } from "@/lib/utils/attendance";

// ─── GET /api/super-admin/overview ───────────────────────────────────────────
// System-wide overview for the Super Admin dashboard (§1).
//
// Deliberately NOT the admin dashboard's numbers: this is about the state of
// the SYSTEM — who is in it, what is in flight, what was changed recently and
// what could not be reversed — rather than operational visit progress, which
// the existing admin dashboard already covers.
//
// One batched $transaction of counts; no per-row loops and no table scans of
// full entities, so the page stays cheap (§16).
export async function GET(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if (gate.response) return gate.response;

  try {
    const today = toMidnightIST(new Date());
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    const [
      totalAdmins, totalSuperAdmins, totalExecutives, activeUsers, inactiveUsers,
      totalClients, activeClients,
      totalVisits, pendingVisits, openVisits, closedVisits, cancelledVisits,
      cfRequested, cfApprovedPending, cfRejected,
      attendanceToday, punchedIn,
      leavesPending, leavesTotal,
    ] = await prisma.$transaction([
      prisma.user.count({ where: { role: "ADMIN" } }),
      prisma.user.count({ where: { role: "SUPER_ADMIN" } }),
      prisma.user.count({ where: { role: "EXECUTIVE" } }),
      prisma.user.count({ where: { isActive: true } }),
      prisma.user.count({ where: { isActive: false } }),

      prisma.client.count(),
      prisma.client.count({ where: { isArchived: false } }),

      prisma.visit.count(),
      prisma.visit.count({ where: { status: "PENDING" } }),
      prisma.visit.count({ where: { status: "OPEN" } }),
      prisma.visit.count({ where: { status: "CLOSED" } }),
      prisma.visit.count({ where: { status: "CANCELLED" } }),

      // Awaiting a Super Admin/Admin decision.
      prisma.subtask.count({
        where: { carryForwardRequestedAt: { not: null }, carryForwardApprovedAt: null, carryForwardRejectedAt: null },
      }),
      // Approved and carried, still not finished.
      prisma.subtask.count({ where: { isCarriedForward: true, isCompleted: false } }),
      prisma.subtask.count({ where: { carryForwardRejectedAt: { not: null } } }),

      prisma.attendance.count({ where: { date: { gte: today, lt: tomorrow } } }),
      prisma.attendance.count({ where: { date: { gte: today, lt: tomorrow }, punchOut: null } }),

      prisma.leaveRequest.count({ where: { status: "PENDING" } }),
      prisma.leaveRequest.count(),
    ]);

    // Recent system changes, split by who made them, plus the ones that could
    // not be reversed — the two things a Super Admin actually needs to notice.
    const [recentOperations, notReversible, recentActivity, currentlyIn] = await Promise.all([
      prisma.adminOperation.findMany({
        select: {
          id: true, action: true, entityType: true, entityId: true, summary: true,
          isReversible: true, undoneAt: true, createdAt: true, reason: true,
          user: { select: { id: true, name: true, role: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 12,
      }),
      prisma.adminOperation.count({ where: { isReversible: false } }),
      prisma.activityLog.findMany({
        select: {
          id: true, action: true, createdAt: true, metadata: true,
          user: { select: { id: true, name: true, role: true } },
          visit: { select: { visitNumber: true, client: { select: { name: true } } } },
        },
        orderBy: { createdAt: "desc" },
        take: 15,
      }),
      prisma.attendance.findMany({
        where: { date: { gte: today, lt: tomorrow }, punchOut: null },
        select: { id: true, punchIn: true, isLate: true, executive: { select: { id: true, name: true } } },
        orderBy: { punchIn: "asc" },
        take: 20,
      }),
    ]);

    const byRole = (roles: string[]) => recentActivity.filter((a) => roles.includes(a.user.role));

    return NextResponse.json({
      users: {
        admins: totalAdmins,
        superAdmins: totalSuperAdmins,
        executives: totalExecutives,
        active: activeUsers,
        inactive: inactiveUsers,
        total: activeUsers + inactiveUsers,
      },
      clients: { total: totalClients, active: activeClients, archived: totalClients - activeClients },
      visits: {
        total: totalVisits,
        pending: pendingVisits,
        inProgress: openVisits,
        closed: closedVisits,
        cancelled: cancelledVisits,
      },
      carryForward: {
        pendingApproval: cfRequested,
        stillPending: cfApprovedPending,
        rejected: cfRejected,
        total: cfRequested + cfApprovedPending + cfRejected,
      },
      attendance: { today: attendanceToday, punchedIn, currentlyIn },
      leaves: { pending: leavesPending, total: leavesTotal },
      operations: { recent: recentOperations, notReversible },
      activity: {
        recent: recentActivity,
        admin: byRole(["ADMIN", "SUPER_ADMIN"]).slice(0, 8),
        executive: byRole(["EXECUTIVE"]).slice(0, 8),
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Super admin overview error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
