"use client";

import { useEffect, useState, useCallback, useMemo, memo } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  Building2, RotateCcw, ChevronRight, Calendar,
  CheckCircle2, Clock, TrendingUp, Search,
} from "lucide-react";
import { formatDate, getProgressColor, cn } from "@/lib/utils/utils";
import { SkeletonCard } from "@/components/ui/Skeleton";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Visit {
  id: string;
  visitNumber: string;
  status: string;
  displayStatus?: string;
  scheduledDate: string;
  progress: number;
  totalSubtasks: number;
  completedSubtasks: number;
  carryForwardCount: number;
  client: { name: string; code: string; contactPerson: string };
}

// ─── Filter Tabs ──────────────────────────────────────────────────────────────

const FILTERS = [
  { key: "", label: "All", icon: null },
  { key: "PENDING", label: "Pending", icon: Clock },
  { key: "IN_PROGRESS", label: "Active", icon: TrendingUp },
  { key: "CLOSED", label: "Closed", icon: CheckCircle2 },
] as const;

// ─── Visit Card (memoized) ─────────────────────────────────────────────────────

const VisitCard = memo(function VisitCard({ visit }: { visit: Visit }) {
  const displayStatus = visit.displayStatus ?? (
    visit.progress === 0 ? "PENDING" : visit.progress < 100 ? "IN_PROGRESS" : "CLOSED"
  );

  const badgeCfg = {
    PENDING:     { label: "Pending",     cls: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
    IN_PROGRESS: { label: "In Progress", cls: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
    CLOSED:      { label: "Closed",      cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
  }[displayStatus] ?? { label: displayStatus, cls: "text-slate-400 bg-slate-500/10 border-slate-500/20" };

  const actionLabel =
    displayStatus === "PENDING" ? "Open visit →" :
    displayStatus === "IN_PROGRESS" ? "Continue →" : "View summary →";

  return (
    <Link
      href={`/executive/visits/${visit.id}`}
      className="block bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 hover:border-slate-700 active:border-blue-500/30 transition-all duration-200 card-hover press-effect group"
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold text-white group-hover:text-blue-300 transition-colors leading-tight truncate">
            {visit.client.name}
          </p>
          <p className="text-sm text-slate-500 mt-0.5 truncate">{visit.client.contactPerson}</p>
        </div>
        <span className={cn(
          "px-2.5 py-1 rounded-full text-xs font-semibold border flex-shrink-0",
          badgeCfg.cls
        )}>
          {badgeCfg.label}
        </span>
      </div>

      {/* Meta */}
      <div className="flex items-center gap-2.5 text-xs text-slate-500 mb-4">
        <span className="font-mono text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded-md">{visit.visitNumber}</span>
        <span className="text-slate-700">·</span>
        <Calendar className="w-3 h-3" />
        <span>{formatDate(visit.scheduledDate)}</span>
      </div>

      {/* Progress */}
      <div className="space-y-2 mb-4">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500">Progress</span>
          <span className="font-bold text-white">{visit.progress}%</span>
        </div>
        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
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
      <div className="pt-3 border-t border-slate-800/60 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500 group-hover:text-blue-400 transition-colors">
          {actionLabel}
        </span>
        <ChevronRight className="w-4 h-4 text-slate-700 group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all" />
      </div>
    </Link>
  );
});

// ─── Empty State ──────────────────────────────────────────────────────────────

const EmptyState = memo(function EmptyState({ filter }: { filter: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-slate-800/60 flex items-center justify-center mb-4">
        <Building2 className="w-8 h-8 text-slate-600" />
      </div>
      <p className="text-base font-semibold text-slate-400">
        {filter ? `No ${filter.toLowerCase().replace("_", " ")} visits` : "No visits found"}
      </p>
      <p className="text-sm text-slate-600 mt-1.5">
        {filter ? "Try selecting a different filter" : "Your visits will appear here"}
      </p>
    </div>
  );
});

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ExecutiveVisitsPage() {
  const [visits, setVisits] = useState<Visit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");

  // Fetch ALL visits once on mount — filter client-side to avoid a network
  // round-trip on every tab switch. Tab switching becomes instant.
  const fetchVisits = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/visits");  // no status param — fetch all
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setVisits(data.visits ?? []);
    } catch {
      toast.error("Failed to load visits");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVisits();
  }, [fetchVisits]);  // only runs once on mount

  // Apply status filter client-side — no extra network requests
  const getDS = useCallback((v: Visit) =>
    v.displayStatus ?? (v.progress === 0 ? "PENDING" : v.progress < 100 ? "IN_PROGRESS" : "CLOSED"),
  []);

  const filteredVisits = useMemo(() => {
    if (!statusFilter) return visits;
    return visits.filter((v) => getDS(v) === statusFilter);
  }, [visits, statusFilter, getDS]);

  // Counts derived from full visits list (always accurate regardless of active filter)
  const counts = useMemo(() => {
    return {
      "": visits.length,
      PENDING: visits.filter((v) => getDS(v) === "PENDING").length,
      IN_PROGRESS: visits.filter((v) => getDS(v) === "IN_PROGRESS").length,
      CLOSED: visits.filter((v) => getDS(v) === "CLOSED").length,
    };
  }, [visits, getDS]);

  return (
    <div className="space-y-5 animate-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">My Visits</h1>
        <p className="text-slate-500 text-sm mt-1">
          All audit visits assigned to you
        </p>
      </div>

      {/* Filter tabs — horizontal scroll on mobile */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
        {FILTERS.map(({ key, label, icon: Icon }) => {
          const active = statusFilter === key;
          const count = counts[key as keyof typeof counts];
          return (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={cn(
                "flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all duration-200 press-effect flex-shrink-0",
                active
                  ? "bg-blue-600/20 text-blue-400 border border-blue-500/30 shadow-sm"
                  : "text-slate-500 hover:text-slate-300 hover:bg-slate-800 border border-transparent"
              )}
            >
              {Icon && <Icon className="w-3.5 h-3.5" />}
              {label}
              {count > 0 && (
                <span className={cn(
                  "text-xs font-bold px-1.5 py-0.5 rounded-full",
                  active ? "bg-blue-500/20 text-blue-300" : "bg-slate-700 text-slate-400"
                )}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : filteredVisits.length === 0 ? (
        <EmptyState filter={statusFilter} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredVisits.map((visit) => (
            <VisitCard key={visit.id} visit={visit} />
          ))}
        </div>
      )}
    </div>
  );
}
