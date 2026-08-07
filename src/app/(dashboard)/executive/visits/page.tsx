"use client";

import { useEffect, useRef, useState, useCallback, useMemo, memo } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  Building2, RotateCcw, ChevronRight, Calendar,
  CheckCircle2, Clock, TrendingUp,
} from "lucide-react";
import { formatDate, cn } from "@/lib/utils/utils";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { useLiveQuery, fetchJSON } from "@/lib/hooks/useLiveQuery";
import { markVisitsSeen } from "@/lib/utils/new-visits";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Visit {
  id: string;
  visitNumber: string;
  status: string;
  displayStatus?: string;
  scheduledDate: string;
  endDate?: string | null;
  progress: number;
  totalSubtasks: number;
  completedSubtasks: number;
  carryForwardCount: number;
  hasCarryForward: boolean;
  client: { name: string; code: string; contactPerson: string };
}

// ─── Filter Tabs ──────────────────────────────────────────────────────────────

const FILTERS = [
  { key: "", label: "All", icon: null },
  { key: "PENDING", label: "Pending", icon: Clock },
  { key: "IN_PROGRESS", label: "Active", icon: TrendingUp },
  { key: "CLOSED", label: "Closed", icon: CheckCircle2 },
] as const;

// ─── Status helpers ────────────────────────────────────────────────────────────

function statusBadgeCls(status: string) {
  if (status === "CLOSED") return "text-green-700 bg-green-50 border-green-200";
  if (status === "IN_PROGRESS") return "text-blue-700 bg-blue-50 border-blue-200";
  return "text-amber-700 bg-amber-50 border-amber-200";
}

function statusLabelStr(status: string) {
  if (status === "CLOSED") return "Closed";
  if (status === "IN_PROGRESS") return "In Progress";
  return "Pending";
}

function progressBarColor(pct: number) {
  if (pct === 100) return "bg-green-500";
  if (pct >= 67) return "bg-[#25488e]";
  if (pct >= 34) return "bg-amber-500";
  if (pct > 0) return "bg-[#800040]";
  return "bg-[#e2e7f0]";
}

// ─── Visit Card (memoized) ─────────────────────────────────────────────────────

const VisitCard = memo(function VisitCard({ visit, isNew }: { visit: Visit; isNew?: boolean }) {
  const displayStatus = visit.displayStatus ?? (
    visit.progress === 0 ? "PENDING" : visit.progress < 100 ? "IN_PROGRESS" : "CLOSED"
  );

  const actionLabel =
    displayStatus === "PENDING" ? "Open visit" :
    displayStatus === "IN_PROGRESS" ? "Continue tasks" : "View summary";

  return (
    <Link
      href={`/executive/visits/${visit.id}`}
      className="block bg-white border border-[#e2e7f0] rounded-xl p-4 sm:p-5 hover:border-[#25488e]/30 hover:shadow-md transition-all duration-200 card-hover press-effect group"
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-base font-semibold text-[#0f1829] group-hover:text-[#25488e] transition-colors leading-tight truncate">
              {visit.client.name}
            </p>
            {/* Transient "newly assigned" notice — visual only, never a status */}
            {isNew && (
              <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#800040] text-white">
                NEW
              </span>
            )}
          </div>
          <p className="text-sm text-[#8896a9] mt-0.5 truncate">{visit.client.contactPerson}</p>
        </div>
        <span className={cn(
          "px-2.5 py-0.5 rounded-full text-xs font-semibold border flex-shrink-0",
          statusBadgeCls(displayStatus)
        )}>
          {statusLabelStr(displayStatus)}
        </span>
      </div>

      {/* Meta */}
      <div className="flex items-center gap-2.5 text-xs text-[#8896a9] mb-4 flex-wrap">
        <span className="font-mono text-[#25488e] bg-[#eef2f9] px-2 py-0.5 rounded-md font-semibold">
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
      <div className="space-y-2 mb-4">
        <div className="flex items-center justify-between text-xs">
          <span className="text-[#8896a9]">Progress</span>
          <span className="font-bold text-[#0f1829] tabular-nums">{visit.progress}%</span>
        </div>
        <div className="h-2 bg-[#f1f4f9] rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-500", progressBarColor(visit.progress))}
            style={{ width: `${visit.progress}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-[#8896a9]">
          <span>{visit.completedSubtasks}/{visit.totalSubtasks} subtasks</span>
          {visit.hasCarryForward && (
            <span className="flex items-center gap-1 text-[#ff944d] font-semibold">
              <RotateCcw className="w-3 h-3" />
              {visit.carryForwardCount > 0 ? `${visit.carryForwardCount} carried` : "Carry Forward"}
            </span>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="pt-3 border-t border-[#f1f4f9] flex items-center justify-between">
        <span className="text-xs font-semibold text-[#8896a9] group-hover:text-[#25488e] transition-colors">
          {actionLabel}
        </span>
        <ChevronRight className="w-4 h-4 text-[#c8d2e0] group-hover:text-[#25488e] group-hover:translate-x-0.5 transition-all" />
      </div>
    </Link>
  );
});

// ─── Empty State ──────────────────────────────────────────────────────────────

const EmptyState = memo(function EmptyState({ filter }: { filter: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 bg-white border border-[#e2e7f0] rounded-xl text-center">
      <div className="w-16 h-16 rounded-2xl bg-[#f1f4f9] flex items-center justify-center mb-4">
        <Building2 className="w-8 h-8 text-[#c8d2e0]" />
      </div>
      <p className="text-base font-semibold text-[#0f1829]">
        {filter ? `No ${filter.toLowerCase().replace("_", " ")} visits` : "No visits found"}
      </p>
      <p className="text-sm text-[#8896a9] mt-1.5">
        {filter ? "Try selecting a different filter" : "Your visits will appear here once assigned"}
      </p>
    </div>
  );
});

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ExecutiveVisitsPage() {
  const [statusFilter, setStatusFilter] = useState("");

  const fetchVisits = useCallback(async () => {
    const data = await fetchJSON<{ visits?: Visit[] }>("/api/visits");
    return (data.visits ?? []) as Visit[];
  }, []);

  // Fetch on mount + silently on focus/visibility (event-driven, no polling)
  // so admin-side config changes reach the executive without a manual reload.
  const { data, loading: isLoading, error } = useLiveQuery(fetchVisits, {
    revalidateOnFocus: true,
    revalidateOnVisible: true,
  });
  // Memoized so it keeps a stable identity between renders — the effects and
  // memos below depend on it, and `data ?? []` would otherwise be a new array
  // on every render.
  const visits = useMemo(() => data ?? [], [data]);

  useEffect(() => {
    if (error) toast.error("Failed to load visits");
  }, [error]);

  // Visits newly assigned since this device last looked. Computed once per
  // mount, and the ids are marked seen immediately — so the badge shows once
  // and is gone after a refresh or a navigation away and back.
  const [newVisitIds, setNewVisitIds] = useState<Set<string>>(new Set());
  const markedRef = useRef(false);
  useEffect(() => {
    if (markedRef.current || visits.length === 0) return;
    markedRef.current = true;
    setNewVisitIds(markVisitsSeen(visits.map((v) => v.id)));
  }, [visits]);

  const getDS = useCallback((v: Visit) =>
    v.displayStatus ?? (v.progress === 0 ? "PENDING" : v.progress < 100 ? "IN_PROGRESS" : "CLOSED"),
  []);

  const filteredVisits = useMemo(() => {
    if (!statusFilter) return visits;
    return visits.filter((v) => getDS(v) === statusFilter);
  }, [visits, statusFilter, getDS]);

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
      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold text-[#0f1829]">My Visits</h1>
        <p className="text-[#8896a9] text-sm mt-1">All audit visits assigned to you</p>
      </div>

      {/* ── Filter Tabs ── */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
        {FILTERS.map(({ key, label, icon: Icon }) => {
          const active = statusFilter === key;
          const count = counts[key as keyof typeof counts];
          return (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={cn(
                "flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all duration-200 press-effect flex-shrink-0 border",
                active
                  ? "bg-[#25488e] text-white border-[#25488e] shadow-sm"
                  : "text-[#4a5568] bg-white border-[#e2e7f0] hover:border-[#25488e]/30 hover:text-[#25488e]"
              )}
            >
              {Icon && <Icon className="w-3.5 h-3.5" />}
              {label}
              {count > 0 && (
                <span className={cn(
                  "text-xs font-bold px-1.5 py-0.5 rounded-full",
                  active ? "bg-white/20 text-white" : "bg-[#f1f4f9] text-[#4a5568]"
                )}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Content ── */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : filteredVisits.length === 0 ? (
        <EmptyState filter={statusFilter} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredVisits.map((visit) => (
            <VisitCard key={visit.id} visit={visit} isNew={newVisitIds.has(visit.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
