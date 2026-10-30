"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2, Circle, Clock, ChevronDown, ChevronRight,
  RotateCcw, Calendar, User, Users, ClipboardList, AlertCircle,
} from "lucide-react";
import { cn, formatDate, getStatusColor } from "@/lib/utils/utils";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { useLiveQuery, fetchJSON } from "@/lib/hooks/useLiveQuery";

// ─── Week-wise Task History ───────────────────────────────────────────────────
// The task-level view of the week the Calendar is showing: every visit in that
// week with its tasks and subtasks, their completion state and dates. It reads
// GET /api/calendar?view=tasks, which uses the calendar's own week window and
// executive scope — an executive sees only their own and their team visits,
// an admin sees every visit (or one executive's, with the filter).
//
// Refreshes like the rest of the app: on week/filter change, on window focus
// or tab visibility, and after any mutation that calls revalidateAll().

interface HistorySubtask {
  id: string;
  title: string;
  isCompleted: boolean;
  completedAt: string | null;
  isCarriedForward: boolean;
  incompletionReason: string | null;
  carryForward: "REQUESTED" | "APPROVED" | "REJECTED" | null;
}

interface HistoryTask {
  id: string;
  taskType: string;
  title: string;
  status: string;
  mdMeetingAnswer: "YES" | "NO" | null;
  completedAt: string | null;
  completedSubtasks: number;
  totalSubtasks: number;
  subtasks: HistorySubtask[];
}

interface HistoryVisit {
  id: string;
  visitNumber: string;
  status: string;
  displayStatus: string;
  visitType: "SOLO" | "TEAM";
  scheduledDate: string;
  endDate: string | null;
  closedAt: string | null;
  hasCarryForward: boolean;
  client: { name: string; code: string };
  lead: { id: string; name: string };
  members: { id: string; name: string }[];
  tasks: HistoryTask[];
}

interface WeekTaskHistoryData {
  weekNumber: number;
  monday: string;
  sunday: string;
  visits: HistoryVisit[];
  totals: { visits: number; tasks: number; completedTasks: number; subtasks: number; completedSubtasks: number };
}

type TaskFilter = "ALL" | "PENDING" | "COMPLETED";

const TASK_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  PARTIALLY_COMPLETED: "Partial",
};

const VISIT_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In Progress",
  CLOSED: "Closed",
};

const CARRY_FORWARD_LABELS: Record<NonNullable<HistorySubtask["carryForward"]>, string> = {
  REQUESTED: "Awaiting carry-forward approval",
  APPROVED: "Carried forward",
  REJECTED: "Carry-forward rejected",
};

function visitDateRange(v: HistoryVisit): string {
  const start = formatDate(v.scheduledDate);
  const end = formatDate(v.endDate ?? v.scheduledDate);
  return start === end ? start : `${start} – ${end}`;
}

// ─── Task row ─────────────────────────────────────────────────────────────────
function TaskRow({
  task,
  isOpen,
  onToggle,
}: {
  task: HistoryTask;
  isOpen: boolean;
  onToggle: (taskId: string) => void;
}) {
  const isDone = task.status === "COMPLETED";
  const hasSubtasks = task.subtasks.length > 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => hasSubtasks && onToggle(task.id)}
        className={cn(
          "w-full px-4 py-2.5 flex items-center gap-3 text-left transition-colors",
          hasSubtasks ? "hover:bg-[#f8fafc] cursor-pointer" : "cursor-default"
        )}
      >
        {isDone
          ? <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
          : <Clock className="w-4 h-4 text-amber-500 flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-[#0f1829] truncate">{task.title}</p>
          <p className="text-[11px] text-[#8896a9]">
            {task.completedSubtasks}/{task.totalSubtasks} subtasks
            {isDone && task.completedAt && ` · Completed ${formatDate(task.completedAt)}`}
            {(task.taskType === "MD_MEETING" || task.taskType === "MR_MONTHLY_REPORT") && task.mdMeetingAnswer &&
              ` · ${task.taskType === "MD_MEETING" ? "MD" : "Completed"}: ${task.mdMeetingAnswer}`}
          </p>
        </div>
        <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-semibold border flex-shrink-0", getStatusColor(task.status))}>
          {TASK_STATUS_LABELS[task.status] ?? task.status}
        </span>
        {hasSubtasks && (isOpen
          ? <ChevronDown className="w-4 h-4 text-[#8896a9] flex-shrink-0" />
          : <ChevronRight className="w-4 h-4 text-[#c8d2e0] flex-shrink-0" />)}
      </button>

      {isOpen && hasSubtasks && (
        <ul className="pb-3 pl-11 pr-4 space-y-2">
          {task.subtasks.map((s) => (
            <li key={s.id} className="flex items-start gap-2">
              {s.isCompleted
                ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600 mt-0.5 flex-shrink-0" />
                : <Circle className="w-3.5 h-3.5 text-[#c8d2e0] mt-0.5 flex-shrink-0" />}
              <div className="min-w-0 flex-1">
                <p className={cn("text-xs", s.isCompleted ? "text-[#4a5568]" : "text-[#0f1829]")}>
                  {s.title}
                  {s.isCarriedForward && (
                    <span className="ml-1.5 text-[10px] font-bold text-[#ff944d]">Carried</span>
                  )}
                </p>
                <p className="text-[11px] text-[#8896a9]">
                  {s.isCompleted ? (s.completedAt ? `Done ${formatDate(s.completedAt)}` : "Done") : "Pending"}
                  {!s.isCompleted && s.carryForward && ` · ${CARRY_FORWARD_LABELS[s.carryForward]}`}
                </p>
                {!s.isCompleted && s.incompletionReason && (
                  <p className="text-[11px] text-amber-700 italic mt-0.5">{s.incompletionReason}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Visit card ───────────────────────────────────────────────────────────────
function VisitHistoryCard({
  visit,
  visitHrefBase,
  expanded,
  onToggleTask,
}: {
  visit: HistoryVisit;
  visitHrefBase: string;
  expanded: Set<string>;
  onToggleTask: (taskId: string) => void;
}) {
  const isTeam = visit.visitType === "TEAM";
  const people = isTeam
    ? [`${visit.lead.name} (Lead)`, ...visit.members.map((m) => m.name)].join(", ")
    : visit.lead.name;

  return (
    <div className="bg-white border border-[#e2e7f0] rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[#f1f4f9] flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-[#0f1829] truncate">{visit.client.name}</p>
            <span className="font-mono text-[11px] text-[#4a5568] bg-[#f8f9fc] border border-[#e2e7f0] px-1.5 py-0.5 rounded-md">
              {visit.visitNumber}
            </span>
            {visit.hasCarryForward && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#ff944d] bg-orange-100 px-1.5 py-0.5 rounded-full">
                <RotateCcw className="w-2.5 h-2.5" /> carry-forward
              </span>
            )}
          </div>
          <div className="flex items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-[#8896a9] flex-wrap">
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" /> {visitDateRange(visit)}
            </span>
            <span className="flex items-center gap-1 min-w-0">
              {isTeam ? <Users className="w-3 h-3 flex-shrink-0" /> : <User className="w-3 h-3 flex-shrink-0" />}
              <span className="truncate">{people}</span>
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-semibold border", getStatusColor(visit.displayStatus))}>
            {VISIT_STATUS_LABELS[visit.displayStatus] ?? visit.displayStatus}
          </span>
          <Link href={`${visitHrefBase}/${visit.id}`} className="text-[11px] font-semibold text-[#25488e] hover:underline">
            View visit
          </Link>
        </div>
      </div>

      {visit.tasks.length === 0 ? (
        <p className="px-4 py-3 text-xs text-[#8896a9]">No tasks on this visit.</p>
      ) : (
        <div className="divide-y divide-[#f1f4f9]">
          {visit.tasks.map((task) => (
            <TaskRow key={task.id} task={task} isOpen={expanded.has(task.id)} onToggle={onToggleTask} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export function WeekTaskHistory({
  weekISO,
  executiveId,
  visitHrefBase,
}: {
  /** Any instant inside the week to show — the Calendar's own week state. */
  weekISO: string;
  /** Admin only: narrow to one executive (ignored by the API for executives). */
  executiveId?: string;
  /** Where "View visit" links to: "/admin/visits" or "/executive/visits". */
  visitHrefBase: string;
}) {
  const [filter, setFilter] = useState<TaskFilter>("ALL");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // The request key travels with the response, so a week/filter change never
  // shows the previous week's tasks under the new week's heading while the
  // new data is loading.
  const requestKey = `${weekISO}|${executiveId ?? ""}`;
  const fetchHistory = useCallback(async () => {
    const params = new URLSearchParams({ week: weekISO, view: "tasks" });
    if (executiveId) params.set("executiveId", executiveId);
    const data = await fetchJSON<WeekTaskHistoryData>(`/api/calendar?${params.toString()}`);
    return { key: `${weekISO}|${executiveId ?? ""}`, data };
  }, [weekISO, executiveId]);

  const { data: result, loading, error, refresh } = useLiveQuery(fetchHistory);
  const data = result && result.key === requestKey ? result.data : null;

  const visits = useMemo(() => {
    if (!data) return [];
    if (filter === "ALL") return data.visits;
    return data.visits
      .map((v) => ({
        ...v,
        tasks: v.tasks.filter((t) => (filter === "COMPLETED" ? t.status === "COMPLETED" : t.status !== "COMPLETED")),
      }))
      .filter((v) => v.tasks.length > 0);
  }, [data, filter]);

  const toggleTask = useCallback((taskId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const allTaskIds = useMemo(
    () => visits.flatMap((v) => v.tasks.filter((t) => t.subtasks.length > 0).map((t) => t.id)),
    [visits]
  );
  const allExpanded = allTaskIds.length > 0 && allTaskIds.every((id) => expanded.has(id));

  if (!data) {
    if (error && !loading) {
      return (
        <div className="flex items-start gap-2 p-4 bg-red-50 border border-red-200 rounded-xl">
          <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-red-800">Could not load the task history for this week.</p>
            <button type="button" onClick={() => void refresh()} className="text-xs font-semibold text-red-700 hover:underline mt-1">
              Try again
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    );
  }

  const { totals } = data;
  const pendingTasks = totals.tasks - totals.completedTasks;

  return (
    <div className="space-y-4">
      {/* ── Week summary ── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Visits this week", value: `${totals.visits}`, color: "text-[#25488e]", Icon: ClipboardList },
          { label: "Tasks completed", value: `${totals.completedTasks}/${totals.tasks}`, color: "text-green-600", Icon: CheckCircle2 },
          { label: "Tasks pending", value: `${pendingTasks}`, color: "text-amber-600", Icon: Clock },
        ].map(({ label, value, color, Icon }) => (
          <div key={label} className="bg-white border border-[#e2e7f0] rounded-xl p-3 sm:p-4 flex items-center gap-3">
            <Icon className={cn("w-4 h-4 flex-shrink-0 hidden sm:block", color)} />
            <div className="min-w-0">
              <p className={cn("text-lg font-bold tabular-nums", color)}>{value}</p>
              <p className="text-[11px] text-[#8896a9] truncate">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Filter + expand ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex p-1 rounded-lg bg-[#f1f4f9] border border-[#e2e7f0]">
          {([
            ["ALL", "All tasks"],
            ["PENDING", "Pending"],
            ["COMPLETED", "Completed"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-semibold transition-all press-effect",
                filter === value ? "bg-white text-[#25488e] shadow-sm" : "text-[#8896a9] hover:text-[#4a5568]"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {allTaskIds.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(allExpanded ? new Set() : new Set(allTaskIds))}
            className="text-xs font-semibold text-[#25488e] hover:underline"
          >
            {allExpanded ? "Hide subtasks" : "Show all subtasks"}
          </button>
        )}
      </div>

      {/* ── Visits ── */}
      {visits.length === 0 ? (
        <div className="text-center py-12 bg-white border border-[#e2e7f0] rounded-xl">
          <ClipboardList className="w-10 h-10 mx-auto mb-3 text-[#c8d2e0]" />
          <p className="text-sm font-semibold text-[#0f1829]">
            {filter === "ALL"
              ? "No visits scheduled this week"
              : filter === "PENDING"
              ? "No pending tasks this week"
              : "No completed tasks this week"}
          </p>
          <p className="text-xs text-[#8896a9] mt-1">Use the arrows above to look at another week.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visits.map((v) => (
            <VisitHistoryCard
              key={v.id}
              visit={v}
              visitHrefBase={visitHrefBase}
              expanded={expanded}
              onToggleTask={toggleTask}
            />
          ))}
        </div>
      )}
    </div>
  );
}
