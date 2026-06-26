"use client";

import { useEffect, useState, useCallback, useMemo, memo } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  CheckCircle2, Clock, RotateCcw, Building2, TrendingUp,
  ChevronRight, Calendar, ArrowRight,
} from "lucide-react";
import { formatDate, getProgressColor, cn } from "@/lib/utils/utils";
import { Modal } from "@/components/ui/Modal";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface VisitSummary {
  id: string;
  visitNumber: string;
  status: string;
  displayStatus: string;
  scheduledDate: string;
  progress: number;
  totalSubtasks: number;
  completedSubtasks: number;
  carryForwardCount: number;
  client: { name: string; code: string; contactPerson: string };
}

type StatusFilter = "" | "PENDING" | "IN_PROGRESS" | "CLOSED";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getDS(v: VisitSummary): string {
  return v.displayStatus || (v.progress === 0 ? "PENDING" : v.progress < 100 ? "IN_PROGRESS" : "CLOSED");
}

// ─── Visit Card (memoized) ─────────────────────────────────────────────────────

const VisitCard = memo(function VisitCard({ visit }: { visit: VisitSummary }) {
  const displayStatus = getDS(visit);

  const badgeClasses =
    displayStatus === "CLOSED"
      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
      : displayStatus === "IN_PROGRESS"
      ? "text-blue-400 bg-blue-500/10 border-blue-500/20"
      : "text-amber-400 bg-amber-500/10 border-amber-500/20";

  const badgeLabel =
    displayStatus === "CLOSED" ? "Closed" :
    displayStatus === "IN_PROGRESS" ? "In Progress" : "Pending";

  return (
    <Link
      href={`/executive/visits/${visit.id}`}
      className="block bg-slate-900 border border-slate-800 rounded-2xl p-4 hover:border-slate-600 transition-all group card-hover press-effect"
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white group-hover:text-blue-300 transition-colors truncate">
            {visit.client.name}
          </p>
          <p className="text-xs text-slate-500 mt-0.5 truncate">{visit.client.contactPerson}</p>
        </div>
        <span className={cn("px-2 py-0.5 rounded-full text-xs font-semibold border flex-shrink-0", badgeClasses)}>
          {badgeLabel}
        </span>
      </div>

      {/* Visit # + Date */}
      <div className="flex items-center gap-2 text-xs text-slate-500 mb-3 flex-wrap">
        <span className="font-mono text-slate-400 bg-slate-800/60 px-1.5 py-0.5 rounded-md">{visit.visitNumber}</span>
        <Calendar className="w-3 h-3" />
        <span>{formatDate(visit.scheduledDate)}</span>
      </div>

      {/* Progress */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-slate-500">Progress</span>
          <span className="font-bold text-white">{visit.progress}%</span>
        </div>
        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-500", getProgressColor(visit.progress))}
            style={{ width: `${visit.progress}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-slate-600">
          <span>{visit.completedSubtasks}/{visit.totalSubtasks} subtasks</span>
          {visit.carryForwardCount > 0 && (
            <span className="flex items-center gap-1 text-orange-400">
              <RotateCcw className="w-3 h-3" />
              {visit.carryForwardCount} carried
            </span>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-3 pt-3 border-t border-slate-800/60 flex items-center justify-between">
        <span className="text-xs text-slate-600 group-hover:text-blue-400 transition-colors">
          {displayStatus === "PENDING" ? "Tap to open" :
           displayStatus === "IN_PROGRESS" ? "Continue tasks" : "View summary"}
        </span>
        <ChevronRight className="w-4 h-4 text-slate-700 group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all" />
      </div>
    </Link>
  );
});

// ─── Drill-Down Panel — uses Modal for proper mobile behaviour ─────────────────

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
    IN_PROGRESS: "In Progress Visits",
    CLOSED:      "Closed Visits",
  };

  const descriptions: Record<StatusFilter, string> = {
    "":          "",
    PENDING:     "0% completed — no subtasks done yet",
    IN_PROGRESS: "1–99% completed",
    CLOSED:      "100% completed",
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
      {/* Subtitle */}
      {descriptions[filter] && (
        <p className="px-5 pt-3 text-xs text-slate-500">{descriptions[filter]}</p>
      )}

      <div className="p-4 sm:p-5">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-600">
            <Building2 className="w-10 h-10 mx-auto mb-3 opacity-40" />
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
  const [visits, setVisits] = useState<VisitSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [showDrillDown, setShowDrillDown] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/visits");
        if (!res.ok) throw new Error("Failed");
        const d = await res.json();
        if (!cancelled) setVisits(d.visits ?? []);
      } catch {
        if (!cancelled) toast.error("Failed to load dashboard");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Derive counts once
  const { pendingVisits, inProgressVisits, closedVisits, carryForwardTotal } = useMemo(() => {
    const pending    = visits.filter((v) => getDS(v) === "PENDING");
    const inProgress = visits.filter((v) => getDS(v) === "IN_PROGRESS");
    const closed     = visits.filter((v) => getDS(v) === "CLOSED");
    const cf = visits.reduce((s, v) => s + v.carryForwardCount, 0);
    return { pendingVisits: pending, inProgressVisits: inProgress, closedVisits: closed, carryForwardTotal: cf };
  }, [visits]);

  const openDrillDown = useCallback((filter: StatusFilter) => {
    setStatusFilter(filter);
    setShowDrillDown(true);
  }, []);

  const statCards = useMemo(() => [
    {
      label: "In Progress", value: inProgressVisits.length,
      color: "text-blue-400", border: "border-blue-500/20", bg: "bg-blue-500/5 hover:bg-blue-500/10",
      icon: TrendingUp, filter: "IN_PROGRESS" as StatusFilter, hint: "1–99%",
    },
    {
      label: "Pending", value: pendingVisits.length,
      color: "text-amber-400", border: "border-amber-500/20", bg: "bg-amber-500/5 hover:bg-amber-500/10",
      icon: Clock, filter: "PENDING" as StatusFilter, hint: "0%",
    },
    {
      label: "Completed", value: closedVisits.length,
      color: "text-emerald-400", border: "border-emerald-500/20", bg: "bg-emerald-500/5 hover:bg-emerald-500/10",
      icon: CheckCircle2, filter: "CLOSED" as StatusFilter, hint: "100%",
    },
    {
      label: "Carry-Fwd", value: carryForwardTotal,
      color: "text-orange-400", border: "border-orange-500/20", bg: "bg-orange-500/5 hover:bg-orange-500/10",
      icon: RotateCcw, filter: "" as StatusFilter, hint: "subtasks",
    },
  ], [pendingVisits.length, inProgressVisits.length, closedVisits.length, carryForwardTotal]);

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div>
          <div className="h-7 w-40 bg-slate-800 rounded-xl" />
          <div className="h-4 w-52 bg-slate-800/60 rounded-lg mt-2" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-slate-900 border border-slate-800 rounded-2xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-36 bg-slate-900 border border-slate-800 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">My Dashboard</h1>
        <p className="text-slate-500 text-sm mt-1">Your field visit overview</p>
      </div>

      {/* Stat cards — clickable drill-down */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.label}
              type="button"
              onClick={() => openDrillDown(card.filter)}
              className={cn(
                "bg-slate-900 border rounded-2xl p-4 text-left transition-all group cursor-pointer press-effect card-hover",
                card.border, card.bg
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-slate-500 font-medium">{card.label}</p>
                <Icon className={cn("w-4 h-4 flex-shrink-0", card.color)} />
              </div>
              <p className={cn("text-3xl font-bold", card.color)}>{card.value}</p>
              <div className="flex items-center justify-between mt-1">
                <p className="text-xs text-slate-600">{card.hint}</p>
                <ArrowRight className="w-3 h-3 text-slate-700 group-hover:text-slate-400 group-hover:translate-x-0.5 transition-all" />
              </div>
            </button>
          );
        })}
      </div>

      {/* Active (In-Progress) visits */}
      {inProgressVisits.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              <h2 className="text-base font-semibold text-white">Active Visits</h2>
            </div>
            <Link
              href="/executive/visits"
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
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

      {/* Pending visits */}
      {pendingVisits.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-white">Pending Visits</h2>
            {pendingVisits.length > 3 && (
              <button
                type="button"
                onClick={() => openDrillDown("PENDING")}
                className="text-xs text-amber-400 hover:text-amber-300 transition-colors flex items-center gap-1"
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

      {/* Empty state */}
      {visits.length === 0 && (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-2xl">
          <div className="w-16 h-16 rounded-2xl bg-slate-800/60 flex items-center justify-center mb-4 mx-auto">
            <Building2 className="w-8 h-8 text-slate-600" />
          </div>
          <p className="text-base font-semibold text-white">No visits assigned</p>
          <p className="text-slate-500 text-sm mt-1.5">Your visits will appear here once assigned</p>
        </div>
      )}

      {/* Drill-down via proper Modal (mobile safe) */}
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
