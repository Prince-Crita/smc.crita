import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { verifyJwt, COOKIE_NAME } from "@/lib/auth/jwt";
import { isAdminRole } from "@/lib/auth/roles";
import { prisma } from "@/lib/db/prisma";
import { formatDate, formatDateTime, getStatusColor, getProgressColor, getRatingColor } from "@/lib/utils/utils";
import { calculateDisplayStatus, DISPLAY_STATUS_LABELS } from "@/lib/utils/visit-status";
import { cn } from "@/lib/utils/utils";
import Link from "next/link";
import { ArrowLeft, Building2, CheckCircle2, XCircle, RotateCcw, FileText, User, Users, Calendar, Clock } from "lucide-react";
import { AutoRevalidate } from "@/components/ui/AutoRevalidate";

export default async function AdminVisitDetailPage({ params }: { params: Promise<{ visitId: string }> }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) redirect("/login");
  const user = await verifyJwt(token);
  if (!user || !isAdminRole(user.role)) redirect("/login");

  const { visitId } = await params;

  const visit = await prisma.visit.findUnique({
    where: { id: visitId },
    include: {
      client: true,
      executive: { select: { name: true, email: true } },
      // A TEAM visit's members live here; `executive` above is the lead. Without
      // this the page could only ever show the lead, which made a correctly
      // assigned team look as though its members had never been saved.
      assignments: {
        select: { role: true, executive: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      },
      tasks: {
        include: { subtasks: { orderBy: { createdAt: "asc" } } },
        orderBy: { orderIndex: "asc" },
      },
      activityLogs: {
        include: { user: { select: { name: true, role: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!visit) notFound();

  const totalSubtasks = visit.tasks.reduce(
  (s: number, t: any) => s + t.subtasks.length,
  0
);
  const completedSubtasks = visit.tasks.reduce(
  (s: number, t: any) =>
    s + t.subtasks.filter((st: any) => st.isCompleted).length,
  0
);
  const progress = totalSubtasks === 0 ? 0 : Math.round((completedSubtasks / totalSubtasks) * 100);
  // Same progress-aware status the visit list, dashboards and calendar show.
  // Rendering the raw DB status here made one visit read "In Progress" on this
  // page while every other page already called it "Closed".
  const displayStatus = calculateDisplayStatus(completedSubtasks, totalSubtasks, visit.status);
  const summary = visit.summaryJson as {
  overallRating?: string;
} | null;
  // Team shape for the header. The lead is Visit.executiveId (rendered from
  // `visit.executive`), so only the non-LEAD rows are listed as members.
  const isTeam = visit.visitType === "TEAM";
  const teamMembers = visit.assignments
    .filter((a) => a.role !== "LEAD")
    .map((a) => a.executive.name);

  return (
    <div className="space-y-5 max-w-4xl">
      <AutoRevalidate />
      <Link href="/admin/visits" className="flex items-center gap-2 text-slate-500 hover:text-white text-sm transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Back to All Visits
      </Link>

      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono text-slate-500">{visit.visitNumber}</span>
              <span className={cn("px-2.5 py-0.5 rounded-full text-xs font-medium border", getStatusColor(displayStatus))}>
                {DISPLAY_STATUS_LABELS[displayStatus]}
              </span>
            </div>
            <h1 className="text-xl font-bold text-white">{visit.client.name}</h1>
            <p className="text-sm text-slate-400 mt-0.5">{visit.client.contactPerson} · {visit.client.address}</p>
          </div>
          {summary && (
            <div className="text-right">
              <p className="text-xs text-slate-500">Overall Rating</p>
              <p className={cn("text-lg font-bold", getRatingColor(summary.overallRating as string))}>
                {String(summary.overallRating)}
              </p>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-slate-800 text-xs text-slate-500">
          <div className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" />Scheduled: <span className="text-slate-300">{formatDate(visit.scheduledDate)}</span></div>
          <div className="flex items-center gap-1.5"><User className="w-3.5 h-3.5" />{isTeam ? "Team Lead" : "Executive"}: <span className="text-slate-300">{visit.executive.name}</span></div>
          {isTeam && (
            <div className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" />Member{teamMembers.length === 1 ? "" : "s"}: <span className="text-slate-300">{teamMembers.length > 0 ? teamMembers.join(", ") : "none"}</span></div>
          )}
          {visit.openedAt && <div className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />Opened: <span className="text-slate-300">{formatDateTime(visit.openedAt)}</span></div>}
          {visit.closedAt && <div className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />Closed: <span className="text-emerald-400">{formatDateTime(visit.closedAt)}</span></div>}
        </div>
      </div>

      {/* Progress */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold text-white">Overall Progress</p>
          <p className="text-xl font-bold text-white">{progress}%</p>
        </div>
        <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
          <div className={cn("h-full rounded-full", getProgressColor(progress))} style={{ width: `${progress}%` }} />
        </div>
        <p className="text-xs text-slate-500 mt-2">{completedSubtasks} of {totalSubtasks} subtasks completed across {visit.tasks.length} tasks</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Tasks */}
        <div className="lg:col-span-2 space-y-3">
          <h2 className="text-base font-semibold text-white">Task Details</h2>
          {visit.tasks.map((task: any) => {
            const completed = task.subtasks.filter(
              (s: any) => s.isCompleted
            ).length;

            const total = task.subtasks.length;

            const pct =
              total === 0 ? 0 : Math.round((completed / total) * 100);

            return (
              <div key={task.id} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {pct === 100 ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-slate-600" />}
                    <p className="text-sm font-medium text-white">{task.title}</p>
                    {(task.taskType === "MD_MEETING" || task.taskType === "MR_MONTHLY_REPORT") && task.mdMeetingAnswer && (
                      <span className={cn("text-xs px-2 py-0.5 rounded-full border", task.mdMeetingAnswer === "YES" ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" : "text-red-400 bg-red-400/10 border-red-400/20")}>
                        {task.taskType === "MD_MEETING" ? "MD" : "Completed"}: {task.mdMeetingAnswer}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-slate-400">{completed}/{total}</span>
                </div>
                <div className="divide-y divide-slate-800/50">
                  {task.subtasks.map((subtask: any) => (
                    <div key={subtask.id} className="px-4 py-2.5 flex items-start gap-3">
                      {subtask.isCompleted ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-red-400/60 mt-0.5 flex-shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className={cn("text-xs", subtask.isCompleted ? "text-slate-400" : "text-slate-300")}>
                          {subtask.title.replace("[CARRY-FORWARD] ", "")}
                          {subtask.isCarriedForward && <span className="ml-2 text-orange-400 text-[10px]">[CF]</span>}
                        </p>
                        {!subtask.isCompleted && subtask.incompletionReason && (
                          <p className="text-xs text-amber-400/70 italic mt-0.5">{subtask.incompletionReason}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Timeline */}
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-white">Activity Log</h2>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-0">
            {visit.activityLogs.map((log: any, idx: number) => (
              <div key={log.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="w-2 h-2 rounded-full bg-blue-500 mt-1 flex-shrink-0" />
                  {idx < visit.activityLogs.length - 1 && <div className="w-px flex-1 bg-slate-800 mt-1" />}
                </div>
                <div className="pb-3 flex-1">
                  <p className="text-xs text-white">{log.action.replace(/_/g, " ")}</p>
                  <p className="text-xs text-slate-600">{log.user.name} · {formatDateTime(log.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
