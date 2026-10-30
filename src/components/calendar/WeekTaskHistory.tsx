"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2, Circle, Clock, ChevronDown, ChevronUp,
  RotateCcw, Calendar, User, Users, ClipboardList, AlertCircle, Building2,
} from "lucide-react";
import { cn, formatDate, getStatusColor } from "@/lib/utils/utils";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { useLiveQuery, fetchJSON } from "@/lib/hooks/useLiveQuery";

// ─── Week-wise Task History ───────────────────────────────────────────────────
// The task-level view of the week the Calendar is showing. Visits are grouped
// by client and every client starts collapsed, so the week reads as a short
// list of client names; opening a client shows its visits with their tasks,
// subtasks, completion state and dates.
//
// Data comes from GET /api/calendar?view=tasks, which uses the calendar's own
// week window and executive scope — an executive sees only their own and their
// team visits, an admin sees every visit (or one executive's, with the
// filter). The status filter is applied by the API on the real rows.
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
  client: { id: string; name: string; code: string };
  lead: { id: string; name: string };
  members: { id: string; name: string }[];
  tasks: HistoryTask[];
}

type StatusFilter = "ALL" | "PENDING" | "COMPLETED" | "CLOSED";

interface WeekTaskHistoryData {
  weekNumber: number;
  monday: string;
  sunday: string;
  status: StatusFilter;
  visits: HistoryVisit[];
  totals: {
    visits: number;
    closedVisits: number;
    tasks: number;
    completedTasks: number;
    pendingTasks: number;
    subtasks: number;
    completedSubtasks: number;
  };
}

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "ALL", label: "All statuses" },
  { value: "PENDING", label: "Pending" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CLOSED", label: "Closed" },
];

const EMPTY_MESSAGES: Record<StatusFilter, string> = {
  ALL: "No visits scheduled this week",
  PENDING: "No pending tasks this week",
  COMPLETED: "No completed tasks this week",
  CLOSED: "No closed visits this week",
};

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

interface ClientGroup {
  client: HistoryVisit["client"];
  visits: HistoryVisit[];
  taskCount: number;
  completedCount: number;
}

// ─── Task (with its subtasks) ─────────────────────────────────────────────────
function TaskBlock({ task }: { task: HistoryTask }) {
  const isDone = task.status === "COMPLETED";
  return (
    <div className="px-4 py-2.5">
      <div className="flex items-center gap-3">
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
      </div>

      {task.subtasks.length > 0 && (
        <ul className="mt-2 pl-7 space-y-1.5">
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

// ─── One visit inside an expanded client ──────────────────────────────────────
function VisitSection({ visit, visitHrefBase }: { visit: HistoryVisit; visitHrefBase: string }) {
  const isTeam = visit.visitType === "TEAM";
  const people = isTeam
    ? [`${visit.lead.name} (Lead)`, ...visit.members.map((m) => m.name)].join(", ")
    : visit.lead.name;

  return (
    <div className="border-t border-[#f1f4f9]">
      <div className="px-4 py-2.5 bg-[#f8f9fc] flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[11px] text-[#4a5568] bg-white border border-[#e2e7f0] px-1.5 py-0.5 rounded-md">
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
          {visit.tasks.map((task) => <TaskBlock key={task.id} task={task} />)}
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
  const [status, setStatus] = useState<StatusFilter>("ALL");
  // Clients are collapsed until opened.
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set());

  // The request key travels with the response, so a week/filter change never
  // shows the previous selection's data under the new heading while the new
  // data is loading.
  const requestKey = `${weekISO}|${executiveId ?? ""}|${status}`;
  const fetchHistory = useCallback(async () => {
    const params = new URLSearchParams({ week: weekISO, view: "tasks" });
    if (executiveId) params.set("executiveId", executiveId);
    if (status !== "ALL") params.set("status", status);
    const data = await fetchJSON<WeekTaskHistoryData>(`/api/calendar?${params.toString()}`);
    return { key: `${weekISO}|${executiveId ?? ""}|${status}`, data };
  }, [weekISO, executiveId, status]);

  const { data: result, loading, error, refresh } = useLiveQuery(fetchHistory);
  const data = result && result.key === requestKey ? result.data : null;

  // Visits grouped by client, clients in name order, visits by date.
  const groups = useMemo<ClientGroup[]>(() => {
    if (!data) return [];
    const byClient = new Map<string, ClientGroup>();
    for (const v of data.visits) {
      let group = byClient.get(v.client.id);
      if (!group) {
        group = { client: v.client, visits: [], taskCount: 0, completedCount: 0 };
        byClient.set(v.client.id, group);
      }
      group.visits.push(v);
      group.taskCount += v.tasks.length;
      group.completedCount += v.tasks.filter((t) => t.status === "COMPLETED").length;
    }
    return [...byClient.values()].sort((a, b) => a.client.name.localeCompare(b.client.name));
  }, [data]);

  const toggleClient = useCallback((clientId: string) => {
    setExpandedClients((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  }, []);

  const allExpanded = groups.length > 0 && groups.every((g) => expandedClients.has(g.client.id));

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

  return (
    <div className="space-y-4">
      {/* ── Week summary (whole week, whatever the filter) ── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Visits this week", value: `${totals.visits}`, color: "text-[#25488e]", Icon: ClipboardList },
          { label: "Tasks completed", value: `${totals.completedTasks}/${totals.tasks}`, color: "text-green-600", Icon: CheckCircle2 },
          { label: "Tasks pending", value: `${totals.pendingTasks}`, color: "text-amber-600", Icon: Clock },
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

      {/* ── Status filter + expand/collapse ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          aria-label="Filter by status"
          className="border border-[#e2e7f0] rounded-lg px-3 py-1.5 text-sm text-[#0f1829] bg-white focus:outline-none focus:ring-2 focus:ring-[#25488e]/30"
        >
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {groups.length > 0 && (
          <button
            type="button"
            onClick={() => setExpandedClients(allExpanded ? new Set() : new Set(groups.map((g) => g.client.id)))}
            className="text-xs font-semibold text-[#25488e] hover:underline"
          >
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
        )}
      </div>

      {/* ── Clients (collapsed until opened) ── */}
      {groups.length === 0 ? (
        <div className="text-center py-12 bg-white border border-[#e2e7f0] rounded-xl">
          <ClipboardList className="w-10 h-10 mx-auto mb-3 text-[#c8d2e0]" />
          <p className="text-sm font-semibold text-[#0f1829]">{EMPTY_MESSAGES[status]}</p>
          <p className="text-xs text-[#8896a9] mt-1">Use the arrows or the date above to look at another week.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => {
            const isOpen = expandedClients.has(g.client.id);
            return (
              <div key={g.client.id} className="bg-white border border-[#e2e7f0] rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleClient(g.client.id)}
                  aria-expanded={isOpen}
                  className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-[#f8fafc] transition-colors"
                >
                  <Building2 className="w-4 h-4 text-[#25488e] flex-shrink-0" />
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <p className="text-sm font-semibold text-[#0f1829] truncate">{g.client.name}</p>
                    <span className="font-mono text-[10px] text-[#8896a9] flex-shrink-0">{g.client.code}</span>
                  </div>
                  <span className="text-[11px] text-[#8896a9] flex-shrink-0 tabular-nums">
                    {g.visits.length} visit{g.visits.length === 1 ? "" : "s"} · {g.completedCount}/{g.taskCount} done
                  </span>
                  {isOpen
                    ? <ChevronUp className="w-4 h-4 text-[#25488e] flex-shrink-0" />
                    : <ChevronDown className="w-4 h-4 text-[#8896a9] flex-shrink-0" />}
                </button>

                {isOpen && g.visits.map((v) => (
                  <VisitSection key={v.id} visit={v} visitHrefBase={visitHrefBase} />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
