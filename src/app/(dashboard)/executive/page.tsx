"use client";

import { useEffect, useState, useCallback, useMemo, memo } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  CheckCircle2, Clock, RotateCcw, Building2, TrendingUp,
  ChevronRight, Calendar, ArrowRight, AlertCircle,
} from "lucide-react";
import { formatDate, getProgressColor, cn } from "@/lib/utils/utils";
import { Modal } from "@/components/ui/Modal";
import { useLiveQuery, fetchJSON } from "@/lib/hooks/useLiveQuery";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface VisitSummary {
  id: string;
  visitNumber: string;
  status: string;
  displayStatus: string;
  scheduledDate: string;
  endDate?: string | null;
  progress: number;
  totalSubtasks: number;
  completedSubtasks: number;
  carryForwardCount: number;
  hasCarryForward: boolean;
  client: { name: string; code: string; contactPerson: string };
}

type StatusFilter = "" | "PENDING" | "IN_PROGRESS" | "CLOSED";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getDS(v: VisitSummary): string {
  return v.displayStatus || (v.progress === 0 ? "PENDING" : v.progress < 100 ? "IN_PROGRESS" : "CLOSED");
}

// ─── Status badge helper ──────────────────────────────────────────────────────
function statusBadge(status: string) {
  if (status === "CLOSED")
    return "text-green-700 bg-green-50 border-green-200";
  if (status === "IN_PROGRESS")
    return "text-blue-700 bg-blue-50 border-blue-200";
  return "text-amber-700 bg-amber-50 border-amber-200";
}
function statusLabel(status: string) {
  if (status === "CLOSED") return "Closed";
  if (status === "IN_PROGRESS") return "In Progress";
  return "Pending";
}

// ─── Visit Card (memoized) ─────────────────────────────────────────────────────

const VisitCard = memo(function VisitCard({ visit }: { visit: VisitSummary }) {
  const displayStatus = getDS(visit);
  const pct = visit.progress;

  // Progress bar fill color
  const barColor =
    pct === 100
      ? "bg-green-500"
      : pct >= 67
      ? "bg-[#25488e]"
      : pct >= 34
      ? "bg-amber-500"
      : pct > 0
      ? "bg-[#800040]"
      : "bg-[#e2e7f0]";

  return (
    <Link
      href={`/executive/visits/${visit.id}`}
      className="block bg-white border border-[#e2e7f0] rounded-xl p-4 hover:border-[#25488e]/30 hover:shadow-md transition-all group card-hover press-effect"
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#0f1829] group-hover:text-[#25488e] transition-colors truncate">
            {visit.client.name}
          </p>
          <p className="text-xs text-[#8896a9] mt-0.5 truncate">{visit.client.contactPerson}</p>
        </div>
        <span className={cn(
          "px-2.5 py-0.5 rounded-full text-xs font-semibold border flex-shrink-0",
          statusBadge(displayStatus)
        )}>
          {statusLabel(displayStatus)}
        </span>
      </div>

      {/* Visit # + Date */}
      <div className="flex items-center gap-3 text-xs text-[#8896a9] mb-3 flex-wrap">
        <span className="font-mono text-[#4a5568] bg-[#f8f9fc] border border-[#e2e7f0] px-1.5 py-0.5 rounded-md">
          {visit.visitNumber}
        </span>
        <span className="flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          Start: {formatDate(visit.scheduledDate)}
        </span>
        <span className="flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          End: {formatDate(visit.endDate ?? visit.scheduledDate)}
        </span>
      </div>

      {/* Progress */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs">
          <span className="text-[#8896a9]">Progress</span>
          <span className="font-bold text-[#0f1829] tabular-nums">{visit.progress}%</span>
        </div>
        <div className="h-2 bg-[#f1f4f9] rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-500", barColor)}
            style={{ width: `${visit.progress}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-[#8896a9]">
          <span>{visit.completedSubtasks}/{visit.totalSubtasks} subtasks</span>
          {visit.hasCarryForward && (
            <span className="flex items-center gap-1 text-[#ff944d] font-medium">
              <RotateCcw className="w-3 h-3" />
              {visit.carryForwardCount > 0 ? `${visit.carryForwardCount} carried` : "Carry Forward"}
            </span>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-3 pt-3 border-t border-[#f1f4f9] flex items-center justify-between">
        <span className="text-xs text-[#8896a9] group-hover:text-[#25488e] transition-colors">
          {displayStatus === "PENDING" ? "Tap to open" :
           displayStatus === "IN_PROGRESS" ? "Continue tasks" : "View summary"}
        </span>
        <ChevronRight className="w-4 h-4 text-[#c8d2e0] group-hover:text-[#25488e] group-hover:translate-x-0.5 transition-all" />
      </div>
    </Link>
  );
});

// ─── Drill-Down Panel ─────────────────────────────────────────────────────────

const DrillDownPanel = memo(function DrillDownPanel({
  filter,
  visits,
  onClose,
}: {
  filter: StatusFilter;
  visits: VisitSummary[];
  onClose: () => void;
}) {
  const titles: Record<StatusFilter, string> = {
    "":          "All Visits",
    PENDING:     "Pending Visits",
    IN_PROGRESS: "In Progress",
    CLOSED:      "Completed Visits",
  };

  const descriptions: Record<StatusFilter, string> = {
    "":          "",
    PENDING:     "No subtasks completed yet — 0% progress",
    IN_PROGRESS: "Partially completed — 1–99% progress",
    CLOSED:      "All subtasks done — 100% progress",
  };

  const filtered = useMemo(
    () => (filter ? visits.filter((v) => getDS(v) === filter) : visits),
    [filter, visits]
  );

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={titles[filter]}
      size="lg"
      overlayClassName="pb-16 sm:pb-0"
    >
      {descriptions[filter] && (
        <p className="px-5 pt-4 text-xs text-[#8896a9]">{descriptions[filter]}</p>
      )}
      <div className="p-4 sm:p-5">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-[#8896a9]">
            <Building2 className="w-10 h-10 mx-auto mb-3 text-[#c8d2e0]" />
            <p className="text-sm">No visits in this category</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((v) => (
              <VisitCard key={v.id} visit={v} />
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
});

// ─── Executive Dashboard ────────────────────────────────────────────────────────

export default function ExecutiveDashboard() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [showDrillDown, setShowDrillDown] = useState(false);

  const fetchVisits = useCallback(async () => {
    const d = await fetchJSON<{ visits?: VisitSummary[] }>("/api/visits");
    return (d.visits ?? []) as VisitSummary[];
  }, []);

  // Fetch on mount + silently when the app regains focus/visibility (an OS
  // event, NOT polling) - admin-side task-config changes appear as soon as
  // the executive returns to the app. Mutations still call refresh().
  const { data, loading: isLoading, error } = useLiveQuery(fetchVisits, {
    revalidateOnFocus: true,
    revalidateOnVisible: true,
  });
  const visits = data ?? [];

  useEffect(() => {
    if (error) toast.error("Failed to load dashboard");
  }, [error]);

  const { pendingVisits, inProgressVisits, closedVisits, carryForwardTotal } = useMemo(() => {
    const pending    = visits.filter((v) => getDS(v) === "PENDING");
    const inProgress = visits.filter((v) => getDS(v) === "IN_PROGRESS");
    const closed     = visits.filter((v) => getDS(v) === "CLOSED");
    const cf = visits.reduce((s, v) => s + (v.carryForwardCount > 0 ? v.carryForwardCount : v.hasCarryForward ? 1 : 0), 0);
    return { pendingVisits: pending, inProgressVisits: inProgress, closedVisits: closed, carryForwardTotal: cf };
  }, [visits]);

  const openDrillDown = useCallback((filter: StatusFilter) => {
    setStatusFilter(filter);
    setShowDrillDown(true);
  }, []);

  // Stat card config
  const statCards = useMemo(() => [
    {
      label: "In Progress",
      value: inProgressVisits.length,
      hint: "1–99% complete",
      icon: TrendingUp,
      iconBg: "bg-blue-50",
      iconColor: "text-[#25488e]",
      valueColor: "text-[#25488e]",
      filter: "IN_PROGRESS" as StatusFilter,
    },
    {
      label: "Pending",
      value: pendingVisits.length,
      hint: "Not started",
      icon: Clock,
      iconBg: "bg-amber-50",
      iconColor: "text-amber-600",
      valueColor: "text-amber-600",
      filter: "PENDING" as StatusFilter,
    },
    {
      label: "Completed",
      value: closedVisits.length,
      hint: "100% done",
      icon: CheckCircle2,
      iconBg: "bg-green-50",
      iconColor: "text-green-600",
      valueColor: "text-green-600",
      filter: "CLOSED" as StatusFilter,
    },
    {
      label: "Carry-Fwd",
      value: carryForwardTotal,
      hint: "Pending subtasks",
      icon: RotateCcw,
      iconBg: "bg-orange-50",
      iconColor: "text-[#ff944d]",
      valueColor: "text-[#ff944d]",
      filter: "" as StatusFilter,
    },
  ], [pendingVisits.length, inProgressVisits.length, closedVisits.length, carryForwardTotal]);

  // ─── Loading state ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6 animate-in">
        {/* Header skeleton */}
        <div className="h-8 w-48 bg-[#e2e7f0] rounded-lg animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-white border border-[#e2e7f0] rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-36 bg-white border border-[#e2e7f0] rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in">
      {/* ── Page Header ── */}
      <div>
        <h1 className="text-2xl font-bold text-[#0f1829]">My Dashboard</h1>
        <p className="text-[#8896a9] text-sm mt-1">Your field visit overview and progress</p>
      </div>

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.label}
              type="button"
              onClick={() => openDrillDown(card.filter)}
              className="bg-white border border-[#e2e7f0] rounded-xl p-4 text-left hover:border-[#25488e]/30 hover:shadow-md transition-all group cursor-pointer press-effect card-hover"
            >
              <div className="flex items-start justify-between mb-3">
                <div className={cn("p-2 rounded-lg flex-shrink-0", card.iconBg)}>
                  <Icon className={cn("w-4 h-4", card.iconColor)} />
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-[#c8d2e0] group-hover:text-[#25488e] group-hover:translate-x-0.5 transition-all mt-0.5" />
              </div>
              <p className={cn("text-2xl sm:text-3xl font-bold tabular-nums", card.valueColor)}>
                {card.value}
              </p>
              <p className="text-xs font-semibold text-[#0f1829] mt-1">{card.label}</p>
              <p className="text-xs text-[#8896a9] mt-0.5">{card.hint}</p>
            </button>
          );
        })}
      </div>

      {/* ── Carry-forward alert ── */}
      {carryForwardTotal > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-start gap-3">
          <div className="p-1.5 bg-orange-100 rounded-lg flex-shrink-0">
            <AlertCircle className="w-4 h-4 text-[#ff944d]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-orange-800">
              {carryForwardTotal} subtask{carryForwardTotal !== 1 ? "s" : ""} carried forward
            </p>
            <p className="text-xs text-orange-600 mt-0.5">
              These incomplete subtasks from previous visits need your attention.
            </p>
          </div>
        </div>
      )}

      {/* ── Active (In-Progress) visits ── */}
      {inProgressVisits.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#25488e] animate-pulse" />
              <h2 className="text-base font-bold text-[#0f1829]">Active Visits</h2>
              <span className="text-xs text-[#8896a9] font-medium">({inProgressVisits.length})</span>
            </div>
            <Link
              href="/executive/visits"
              className="text-xs text-[#25488e] hover:text-[#1e3a72] font-semibold transition-colors flex items-center gap-1"
            >
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {inProgressVisits.slice(0, 4).map((visit) => (
              <VisitCard key={visit.id} visit={visit} />
            ))}
          </div>
        </div>
      )}

      {/* ── Pending visits ── */}
      {pendingVisits.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-[#0f1829]">Pending Visits</h2>
            {pendingVisits.length > 3 && (
              <button
                type="button"
                onClick={() => openDrillDown("PENDING")}
                className="text-xs text-[#25488e] hover:text-[#1e3a72] font-semibold transition-colors flex items-center gap-1"
              >
                See all {pendingVisits.length} <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {pendingVisits.slice(0, 4).map((visit) => (
              <VisitCard key={visit.id} visit={visit} />
            ))}
          </div>
        </div>
      )}

      {/* ── Recently closed ── */}
      {closedVisits.length > 0 && inProgressVisits.length === 0 && pendingVisits.length === 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-[#0f1829]">Completed Visits</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {closedVisits.slice(0, 4).map((visit) => (
              <VisitCard key={visit.id} visit={visit} />
            ))}
          </div>
        </div>
      )}

      {/* ── Empty state ── */}
      {visits.length === 0 && (
        <div className="text-center py-20 bg-white border border-[#e2e7f0] rounded-xl">
          <div className="w-16 h-16 rounded-2xl bg-[#f1f4f9] flex items-center justify-center mb-4 mx-auto">
            <Building2 className="w-8 h-8 text-[#c8d2e0]" />
          </div>
          <p className="text-base font-semibold text-[#0f1829]">No visits assigned</p>
          <p className="text-[#8896a9] text-sm mt-1.5">
            Your visits will appear here once assigned by the admin
          </p>
        </div>
      )}

      {/* ── Drill-down modal ── */}
      {showDrillDown && (
        <DrillDownPanel
          filter={statusFilter}
          visits={visits}
          onClose={() => setShowDrillDown(false)}
        />
      )}
    </div>
  );
}
