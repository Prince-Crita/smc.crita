"use client";

import { useEffect, useState, useCallback, useMemo, memo } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  Building2, Search, RotateCcw, Eye, ArrowLeftRight,
  Clock, TrendingUp, CheckCircle2, ClipboardList,
} from "lucide-react";
import { formatDate, getProgressColor } from "@/lib/utils/utils";
import { cn } from "@/lib/utils/utils";
import { ReassignVisitModal } from "@/components/admin/ReassignVisitModal";
import { SkeletonCard, SkeletonTable } from "@/components/ui/Skeleton";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Visit {
  id: string;
  visitNumber: string;
  status: string;
  displayStatus: string;
  scheduledDate: string;
  closedAt?: string;
  progress: number;
  totalSubtasks: number;
  completedSubtasks: number;
  carryForwardCount: number;
  client: { id: string; name: string; code: string };
  executive: { id: string; name: string };
  executiveId: string;
}

interface FilterData {
  clients: { id: string; name: string; code: string }[];
  executives: { id: string; name: string }[];
  stats: { total: number; pending: number; inProgress: number; closed: number };
}

// ─── Status badge helper ──────────────────────────────────────────────────────

function statusBadge(displayStatus: string) {
  if (displayStatus === "CLOSED")
    return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  if (displayStatus === "IN_PROGRESS")
    return "bg-blue-500/10 text-blue-400 border-blue-500/20";
  return "bg-amber-500/10 text-amber-400 border-amber-500/20";
}

function statusLabel(displayStatus: string) {
  if (displayStatus === "CLOSED") return "Closed";
  if (displayStatus === "IN_PROGRESS") return "In Progress";
  return "Pending";
}

// ─── Mobile Visit Card (memoized) ─────────────────────────────────────────────

const MobileVisitCard = memo(function MobileVisitCard({
  visit,
  onView,
  onReassign,
}: {
  visit: Visit;
  onView: (id: string) => void;
  onReassign: (visit: Visit) => void;
}) {
  return (
    <div
      className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 card-hover press-effect"
      onClick={() => onView(visit.id)}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">{visit.client.name}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            <span className="font-mono">{visit.visitNumber}</span>
            {" · "}
            {visit.executive.name}
          </p>
        </div>
        <span className={cn(
          "px-2 py-0.5 rounded-full text-xs font-semibold border flex-shrink-0",
          statusBadge(visit.displayStatus)
        )}>
          {statusLabel(visit.displayStatus)}
        </span>
      </div>

      {/* Progress */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500">{formatDate(visit.scheduledDate)}</span>
          <span className="font-semibold text-white">{visit.progress}%</span>
        </div>
        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full", getProgressColor(visit.progress))}
            style={{ width: `${visit.progress}%` }}
          />
        </div>
        {visit.carryForwardCount > 0 && (
          <p className="text-xs text-orange-400 flex items-center gap-1">
            <RotateCcw className="w-3 h-3" />
            {visit.carryForwardCount} items carried forward
          </p>
        )}
      </div>

      {/* Actions */}
      <div
        className="pt-2 border-t border-slate-800/60 flex items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => onView(visit.id)}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors press-effect"
        >
          <Eye className="w-3.5 h-3.5" />
          View
        </button>
        {visit.status !== "CLOSED" && (
          <button
            onClick={() => onReassign(visit)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-xs font-medium transition-colors press-effect"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            Reassign
          </button>
        )}
      </div>
    </div>
  );
});

// ─── Desktop Table Row (memoized) ─────────────────────────────────────────────

const TableRow = memo(function TableRow({
  visit,
  onView,
  onReassign,
}: {
  visit: Visit;
  onView: (id: string) => void;
  onReassign: (visit: Visit) => void;
}) {
  return (
    <tr
      className="hover:bg-slate-800/20 transition-colors group cursor-pointer border-b border-slate-800/50 last:border-0"
      onClick={() => onView(visit.id)}
    >
      <td className="px-5 py-3.5">
        <span className="text-sm font-mono text-slate-300 bg-slate-800/60 px-2 py-0.5 rounded-md">
          {visit.visitNumber}
        </span>
      </td>
      <td className="px-5 py-3.5">
        <p className="text-sm font-medium text-white">{visit.client.name}</p>
        <p className="text-xs text-slate-500 mt-0.5">{visit.client.code}</p>
      </td>
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            {visit.executive.name.charAt(0)}
          </div>
          <p className="text-sm text-slate-300">{visit.executive.name}</p>
        </div>
      </td>
      <td className="px-5 py-3.5">
        <p className="text-sm text-slate-400">{formatDate(visit.scheduledDate)}</p>
      </td>
      <td className="px-5 py-3.5">
        <span className={cn(
          "px-2.5 py-1 rounded-full text-xs font-semibold border",
          statusBadge(visit.displayStatus)
        )}>
          {statusLabel(visit.displayStatus)}
        </span>
      </td>
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-2">
          <div className="w-24 h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full", getProgressColor(visit.progress))}
              style={{ width: `${visit.progress}%` }}
            />
          </div>
          <span className="text-xs text-slate-400 tabular-nums w-8">{visit.progress}%</span>
        </div>
      </td>
      <td className="px-5 py-3.5">
        {visit.carryForwardCount > 0 ? (
          <span className="flex items-center gap-1 text-xs text-orange-400">
            <RotateCcw className="w-3 h-3" />
            {visit.carryForwardCount}
          </span>
        ) : (
          <span className="text-xs text-slate-700">—</span>
        )}
      </td>
      <td
        className="px-5 py-3.5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1">
          <button
            onClick={() => onView(visit.id)}
            className="opacity-0 group-hover:opacity-100 transition-all p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white press-effect"
            title="View"
          >
            <Eye className="w-4 h-4" />
          </button>
          {visit.status !== "CLOSED" && (
            <button
              onClick={() => onReassign(visit)}
              className="opacity-0 group-hover:opacity-100 transition-all p-1.5 rounded-lg hover:bg-blue-500/20 text-slate-400 hover:text-blue-400 press-effect"
              title="Reassign"
            >
              <ArrowLeftRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
});

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminVisitsPage() {
  const router = useRouter();
  const [visits, setVisits] = useState<Visit[]>([]);
  const [filterData, setFilterData] = useState<FilterData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [reassignVisit, setReassignVisit] = useState<Visit | null>(null);
  const [clientFilter, setClientFilter] = useState("");
  const [executiveFilter, setExecutiveFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // Debounce the search input by 250ms to avoid per-keystroke useMemo re-runs.
  // This is especially noticeable on mobile where each keystroke can feel laggy.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 250);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const fetchVisits = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (clientFilter) params.set("clientId", clientFilter);
      if (executiveFilter) params.set("executiveId", executiveFilter);
      if (statusFilter) params.set("status", statusFilter);

      const res = await fetch(`/api/admin/visits?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setVisits(data.visits);
      setFilterData({ clients: data.clients, executives: data.executives, stats: data.stats });
    } catch {
      toast.error("Failed to load visits");
    } finally {
      setIsLoading(false);
    }
  }, [clientFilter, executiveFilter, statusFilter]);

  useEffect(() => { fetchVisits(); }, [fetchVisits]);

  const filteredVisits = useMemo(() => {
    if (!debouncedSearch) return visits;
    const term = debouncedSearch.toLowerCase();
    return visits.filter((v) =>
      v.visitNumber.toLowerCase().includes(term) ||
      v.client.name.toLowerCase().includes(term) ||
      v.executive.name.toLowerCase().includes(term)
    );
  }, [visits, debouncedSearch]);

  const handleView = useCallback((id: string) => router.push(`/admin/visits/${id}`), [router]);
  const handleReassign = useCallback((visit: Visit) => setReassignVisit(visit), []);

  const statCards = useMemo(() => [
    { label: "Total", value: filterData?.stats.total ?? 0, color: "text-white", filter: "", icon: ClipboardList },
    { label: "Pending", value: filterData?.stats.pending ?? 0, color: "text-amber-400", filter: "PENDING", icon: Clock },
    { label: "In Progress", value: filterData?.stats.inProgress ?? 0, color: "text-blue-400", filter: "IN_PROGRESS", icon: TrendingUp },
    { label: "Closed", value: filterData?.stats.closed ?? 0, color: "text-emerald-400", filter: "CLOSED", icon: CheckCircle2 },
  ], [filterData]);

  return (
    <div className="space-y-5 animate-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">All Visits</h1>
        <p className="text-slate-500 text-sm mt-1">Monitor and manage all audit visits</p>
      </div>

      {/* Stat mini-cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {statCards.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.label}
              onClick={() => setStatusFilter(prev => prev === s.filter ? "" : s.filter)}
              className={cn(
                "bg-slate-900 border rounded-2xl px-4 py-3.5 text-left transition-all press-effect card-hover",
                statusFilter === s.filter
                  ? "border-slate-600 ring-1 ring-slate-600 bg-slate-800/40"
                  : "border-slate-800 hover:border-slate-700"
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-slate-500 font-medium">{s.label}</p>
                <Icon className={cn("w-3.5 h-3.5", s.color)} />
              </div>
              <p className={cn("text-2xl font-bold", s.color)}>{s.value}</p>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search visit, client, or executive..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-slate-800 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/50 transition-all"
            />
          </div>

          {/* Dropdowns */}
          <div className="flex gap-2 flex-wrap">
            <select
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              className="px-3 py-2.5 bg-slate-800 border border-slate-700/80 rounded-xl text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all"
            >
              <option value="">All Clients</option>
              {filterData?.clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select
              value={executiveFilter}
              onChange={(e) => setExecutiveFilter(e.target.value)}
              className="px-3 py-2.5 bg-slate-800 border border-slate-700/80 rounded-xl text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all"
            >
              <option value="">All Executives</option>
              {filterData?.executives.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Results count */}
      {!isLoading && (
        <p className="text-xs text-slate-600">
          Showing <span className="text-slate-400 font-semibold">{filteredVisits.length}</span> of{" "}
          <span className="text-slate-400 font-semibold">{visits.length}</span> visits
        </p>
      )}

      {/* Content */}
      {isLoading ? (
        <>
          {/* Mobile skeleton */}
          <div className="md:hidden space-y-3">
            {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
          </div>
          {/* Desktop skeleton */}
          <div className="hidden md:block">
            <SkeletonTable rows={6} />
          </div>
        </>
      ) : filteredVisits.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 bg-slate-900 border border-slate-800 rounded-2xl text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-800/60 flex items-center justify-center mb-4">
            <Building2 className="w-8 h-8 text-slate-600" />
          </div>
          <p className="text-base font-semibold text-slate-400">No visits found</p>
          <p className="text-sm text-slate-600 mt-1.5">
            {searchTerm ? "Try a different search term" : "Adjust your filters to see results"}
          </p>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {filteredVisits.map((visit) => (
              <MobileVisitCard
                key={visit.id}
                visit={visit}
                onView={handleView}
                onReassign={handleReassign}
              />
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800/80 bg-slate-900/50">
                    {["Visit #", "Client", "Executive", "Date", "Status", "Progress", "CF", "Actions"].map((h) => (
                      <th key={h} className="text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider px-5 py-3">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredVisits.map((visit) => (
                    <TableRow
                      key={visit.id}
                      visit={visit}
                      onView={handleView}
                      onReassign={handleReassign}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Reassign modal */}
      <ReassignVisitModal
        visit={reassignVisit ? {
          id: reassignVisit.id,
          visitNumber: reassignVisit.visitNumber,
          executiveId: reassignVisit.executiveId,
          executive: { name: reassignVisit.executive.name },
        } : null}
        executives={filterData?.executives.map((e) => ({ id: e.id, name: e.name })) ?? []}
        onClose={() => setReassignVisit(null)}
        onSuccess={fetchVisits}
      />
    </div>
  );
}
