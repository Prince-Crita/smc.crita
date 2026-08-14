import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { prisma } from "@/lib/db/prisma";
import { validateVisitClose, executeCarryForward, hasEndDatePassed } from "@/lib/utils/carry-forward";
import { generateVisitSummary, VisitData } from "@/lib/utils/summary";
import { canCloseVisit, canViewVisit } from "@/lib/utils/visit-access";
import { sendEmail } from "@/lib/email/mailer";
import { generateVisitSummaryEmail } from "@/lib/email/templates/visit-summary";
import { Prisma } from "@prisma/client";

// POST /api/visits/[visitId]/close - Close a visit with carry-forward and summary generation
export async function POST(request: NextRequest, { params }: { params: Promise<{ visitId: string }> }) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "EXECUTIVE") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { visitId } = await params;

  try {
    const visit = await prisma.visit.findUnique({
      where: { id: visitId },
      include: {
        // Select only the client fields needed by the close workflow:
        // name (for activity log + email), email + reportEmails (email recipients)
        client: {
          select: {
            name: true,
            email: true,
            reportEmails: true,
          },
        },
        executive: { select: { id: true, name: true, email: true } },
        assignments: { select: { executiveId: true, role: true } },
        tasks: {
          include: { subtasks: true },
          orderBy: { orderIndex: "asc" },
        },
      },
    });

    if (!visit) return NextResponse.json({ error: "Visit not found" }, { status: 404 });
    // Closing is owner-only: the solo executive, or the TEAM LEAD. A team
    // member who can view and work the visit still cannot close it, and gets a
    // message saying why rather than a bare "Forbidden".
    if (!canCloseVisit(visit, user.userId)) {
      const onTeam = canViewVisit(visit, user.userId);
      return NextResponse.json(
        {
          error: onTeam
            ? "Only the Team Lead can close this visit."
            : "Forbidden",
        },
        { status: 403 }
      );
    }
    if (visit.status !== "OPEN") {
      return NextResponse.json({ error: "Only open visits can be closed" }, { status: 400 });
    }

    // Validate before closing
    const validationErrors = validateVisitClose(visit);
    if (validationErrors.length > 0) {
      return NextResponse.json({ error: "Cannot close visit", validationErrors }, { status: 422 });
    }

    // Carry-forward is NO LONGER created automatically on close (§7). Closing
    // a visit with unfinished work now raises PENDING carry-forward REQUESTS,
    // which an admin approves (and dates) from Admin → Carry Forward. Nothing
    // is copied into any visit here.
    const carryForwardRequests = visit.tasks.flatMap((t) =>
      t.subtasks.filter((s) => !s.isCompleted && !s.isCarriedForward && !s.carryForwardApprovedAt)
    );
    if (carryForwardRequests.length > 0) {
      await prisma.subtask.updateMany({
        where: { id: { in: carryForwardRequests.map((s) => s.id) }, carryForwardRequestedAt: null },
        data: { carryForwardRequestedAt: new Date() },
      });
    }
    // Reported in the summary as "awaiting admin approval", not as carried.
    const carriedCount = 0;
    const nextVisitId: string | null = null;

    // Generate visit summary
    const summary = generateVisitSummary(visit as unknown as VisitData, carriedCount);

    const body = await request.json().catch(() => ({}));

    // Close the visit
    const closedVisit = await prisma.visit.update({
      where: { id: visitId },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        notes: body.notes,
        summaryJson: summary as unknown as Prisma.InputJsonValue,
      },
    });

    // Update all task statuses in parallel — previously a sequential for-loop
    // that fired one DB write per task. With Promise.all all writes run concurrently.
    await Promise.all(
      visit.tasks.map((task) => {
        const completedCount = task.subtasks.filter((s) => s.isCompleted).length;
        const totalCount = task.subtasks.length;
        let taskStatus: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "PARTIALLY_COMPLETED" = "PENDING";
        if (completedCount === totalCount && totalCount > 0) taskStatus = "COMPLETED";
        else if (completedCount > 0) taskStatus = "PARTIALLY_COMPLETED";
        return prisma.task.update({
          where: { id: task.id },
          data: { status: taskStatus, completedAt: completedCount > 0 ? new Date() : null },
        });
      })
    );

    // Write both activity log entries in parallel — no ordering dependency between them
    await Promise.all([
      prisma.activityLog.create({
        data: {
          visitId,
          userId: user.userId,
          action: "VISIT_CLOSED",
          metadata: {
            visitNumber: visit.visitNumber,
            clientName: visit.client.name,
            completionPercentage: summary.completionPercentage,
            carryForwardCount: carriedCount,
            nextVisitId,
            overallRating: summary.overallRating,
          },
        },
      }),
      prisma.activityLog.create({
        data: {
          visitId,
          userId: user.userId,
          action: "SUMMARY_GENERATED",
          metadata: {
            visitNumber: visit.visitNumber,
            rating: summary.overallRating,
            completionPercentage: summary.completionPercentage,
          },
        },
      }),
    ]);

    // Send email notification (non-blocking — don't fail the close if email fails)
    try {
      const totalSubtasks = visit.tasks.reduce((s, t) => s + t.subtasks.length, 0);
      const completedSubtasks = visit.tasks.reduce((s, t) => s + t.subtasks.filter((st) => st.isCompleted).length, 0);

      const emailHtml = generateVisitSummaryEmail({
        visitNumber: visit.visitNumber,
        clientName: visit.client.name,
        executiveName: visit.executive.name,
        scheduledDate: new Date(visit.scheduledDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
        closedAt: new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
        progress: summary.completionPercentage,
        totalTasks: visit.tasks.length,
        completedTasks: visit.tasks.filter((t) => t.subtasks.every((st) => st.isCompleted)).length,
        totalSubtasks,
        completedSubtasks,
        carryForwardCount: carriedCount,
        rating: summary.overallRating,
        notes: body.notes,
        tasks: visit.tasks.map((t) => ({
          title: t.title,
          status: t.subtasks.every((st) => st.isCompleted) ? "COMPLETED" : t.subtasks.some((st) => st.isCompleted) ? "PARTIALLY_COMPLETED" : "PENDING",
          completedSubtasks: t.subtasks.filter((st) => st.isCompleted).length,
          totalSubtasks: t.subtasks.length,
        })),
      });

      // Collect recipients: admin + client report emails
      const recipients: string[] = [];
      if (process.env.ADMIN_EMAIL) recipients.push(process.env.ADMIN_EMAIL);
      if (visit.client.reportEmails?.length) recipients.push(...visit.client.reportEmails);
      if (visit.client.email) recipients.push(visit.client.email);

      if (recipients.length > 0) {
        await sendEmail({
          to: [...new Set(recipients)], // deduplicate
          subject: `✅ Visit Closed — ${visit.visitNumber} | ${visit.client.name}`,
          html: emailHtml,
        });
      }
    } catch (emailError) {
      // Log but don't fail the close operation
      console.error("Email notification failed (visit still closed):", emailError);
    }

    return NextResponse.json({
      success: true,
      visit: closedVisit,
      summary,
      carriedCount,
      nextVisitId,
    });
  } catch (error) {
    console.error("Close visit error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
