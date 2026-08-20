"use client";

import { useEffect, useState, useCallback, useMemo, memo } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  Building2, Search, RotateCcw, Eye, ArrowLeftRight,
  Clock, TrendingUp, CheckCircle2, ClipboardList, Filter,
} from "lucide-react";
import { formatDate } from "@/lib/utils/utils";
import { cn } from "@/lib/utils/utils";
import { ReassignVisitModal } from "@/components/admin/ReassignVisitModal";
import { SkeletonCard, SkeletonTable } from "@/components/ui/Skeleton";
import { useLiveQuery, fetchJSON } from "@/lib/hooks/useLiveQuery";
import { useIsDesktop } from "@/lib/hooks/useIsDesktop";

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
  hasCarryForward: boolean;
  client: { id: string; name: string; code: string };
  executive: { id: string; name: string };
  executiveId: string;
}

interface FilterData {
  clients: { id: string; name: string; code: string }[];
  executives: { id: string; name: string }[];
  stats: { total: number; pending: number; inProgress: number; closed: number };
}

// ─── Status badge helpers ──────────────────────────────────────────────────────

function statusBadgeCls(displayStatus: string) {
  if (displayStatus === "CLOSED")
    return "text-green-700 bg-green-50 border-green-200";
  if (displayStatus === "IN_PROGRESS")
    return "text-blue-700 bg-blue-50 border-blue-200";
  return "text-amber-700 bg-amber-50 border-amber-200";
}

function statusLabel(displayStatus: string) {
  if (displayStatus === "CLOSED") return "Closed";
  if (displayStatus === "IN_PROGRESS") return "In Progress";
  return "Pending";
}

function progressBarColor(pct: number) {
  if (pct === 100) return "bg-green-500";
  if (pct >= 67)  return "bg-[#25488e]";
  if (pct >= 34)  return "bg-amber-500";
  if (pct > 0)    return "bg-[#800040]";
  return "bg-[#e2e7f0]";
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
      className="bg-white border border-[#e2e7f0] rounded-xl p-4 space-y-3 card-hover press-effect cursor-pointer"
      onClick={() => onView(visit.id)}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#0f1829] truncate">{visit.client.name}</p>
          <p className="text-xs text-[#8896a9] mt-0.5">
            <span className="font-mono">{visit.visitNumber}</span>
            {" · "}
            {visit.executive.name}
          </p>
        </div>
        <span className={cn(
          "px-2.5 py-0.5 rounded-full text-xs font-semibold border flex-shrink-0",
          statusBadgeCls(visit.displayStatus)
        )}>
          {statusLabel(visit.displayStatus)}
        </span>
      </div>

      {/* Progress */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-[#8896a9]">{formatDate(visit.scheduledDate)}</span>
          <span className="font-semibold text-[#0f1829] tabular-nums">{visit.progress}%</span>
        </div>
        <div className="h-2 bg-[#f1f4f9] rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-500", progressBarColor(visit.progress))}
            style={{ width: `${visit.progress}%` }}
          />
        </div>
        {visit.hasCarryForward && (
          <p className="text-xs text-[#ff944d] flex items-center gap-1 font-medium">
            <RotateCcw className="w-3 h-3" />
            {visit.carryForwardCount > 0 ? `${visit.carryForwardCount} items carried forward` : "Carry Forward"}
          </p>
        )}
      </div>

      {/* Actions */}
      <div
        className="pt-2.5 border-t border-[#f1f4f9] flex items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => onView(visit.id)}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[#f8f9fc] hover:bg-[#eef2f9] text-[#4a5568] hover:text-[#25488e] text-xs font-semibold transition-colors press-effect border border-[#e2e7f0]"
        >
          <Eye className="w-3.5 h-3.5" />
          View
        </button>
        {visit.status !== "CLOSED" && (
          <button
            onClick={() => onReassign(visit)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold transition-colors press-effect border border-blue-200"
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
      className="hover:bg-[#f8f9fc] transition-colors group cursor-pointer border-b border-[#f1f4f9] last:border-0"
      onClick={() => onView(visit.id)}
    >
      <td className="px-5 py-3.5">
        <span className="text-sm font-mono text-[#25488e] bg-[#eef2f9] px-2 py-0.5 rounded-md font-semibold">
          {visit.visitNumber}
        </span>
      </td>
      <td className="px-5 py-3.5">
        <p className="text-sm font-semibold text-[#0f1829]">{visit.client.name}</p>
        <p className="text-xs text-[#8896a9] mt-0.5">{visit.client.code}</p>
      </td>
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-[#25488e] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            {visit.executive.name.charAt(0)}
          </div>
          <p className="text-sm text-[#4a5568]">{visit.executive.name}</p>
        </div>
      </td>
      <td className="px-5 py-3.5">
        <p className="text-sm text-[#4a5568]">{formatDate(visit.scheduledDate)}</p>
      </td>
      <td className="px-5 py-3.5">
        <span className={cn(
          "px-2.5 py-1 rounded-full text-xs font-semibold border",
          statusBadgeCls(visit.displayStatus)
        )}>
          {statusLabel(visit.displayStatus)}
        </span>
      </td>
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-2">
          <div className="w-24 h-2 bg-[#f1f4f9] rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full", progressBarColor(visit.progress))}
              style={{ width: `${visit.progress}%` }}
            />
          </div>
          <span className="text-xs text-[#4a5568] tabular-nums font-medium w-9">{visit.progress}%</span>
        </div>
      </td>
      <td className="px-5 py-3.5">
        {visit.hasCarryForward ? (
          <span className="flex items-center gap-1 text-xs text-[#ff944d] font-semibold">
            <RotateCcw className="w-3 h-3" />
            {visit.carryForwardCount > 0 ? visit.carryForwardCount : ""}
          </span>
        ) : (
          <span className="text-xs text-[#c8d2e0]">—</span>
        )}
      </td>
      <td
        className="px-5 py-3.5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Same labeled action buttons as the mobile card - always visible */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onView(visit.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f8f9fc] hover:bg-[#eef2f9] text-[#4a5568] hover:text-[#25488e] text-xs font-semibold transition-colors press-effect border border-[#e2e7f0]"
          >
            <Eye className="w-3.5 h-3.5" />
            View
          </button>
          {visit.status !== "CLOSED" && (
            <button
              onClick={() => onReassign(visit)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f8f9fc] hover:bg-blue-50 text-[#4a5568] hover:text-blue-600 text-xs font-semibold transition-colors press-effect border border-[#e2e7f0]"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              Reassign
            </button>
          )}
        </div>
      </td>
    </tr>
  );
});

// ─── Main Page ────────────────────────────────────────────────────────────────

/** Shared empty array — see the note where it is used below. */
const NO_VISITS: Visit[] = [];

export default function AdminVisitsPage() {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [reassignVisit, setReassignVisit] = useState<Visit | null>(null);
  const [clientFilter, setClientFilter] = useState("");
  const [executiveFilter, setExecutiveFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 250);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const fetchVisits = useCallback(async () => {
    const params = new URLSearchParams();
    if (clientFilter) params.set("clientId", clientFilter);
    if (executiveFilter) params.set("executiveId", executiveFilter);
    if (statusFilter) params.set("status", statusFilter);

    const data = await fetchJSON<{ visits: unknown; clients: unknown; executives: unknown; stats: unknown }>(`/api/admin/visits?${params}`);
    return {
      visits: data.visits as Visit[],
      filterData: { clients: data.clients, executives: data.executives, stats: data.stats } as FilterData,
    };
  }, [clientFilter, executiveFilter, statusFilter]);

  // Only the layout on screen is built: this list used to render every visit
  // TWICE — once as a desktop table row and once as a mobile card — with CSS
  // hiding whichever one did not belong.
  const isDesktop = useIsDesktop();

  // Fetch once on mount / filter change; refreshed only by explicit mutations. No polling.
  const { data: visitsData, loading: isLoading, error, refresh: refreshVisits } = useLiveQuery(fetchVisits);
  // Stable identity for the empty case — `?? []` returned a new array each
  // render and defeated the useMemo that filters this list.
  const visits = visitsData?.visits ?? NO_VISITS;
  const filterData = visitsData?.filterData ?? null;

  useEffect(() => {
    if (error) toast.error("Failed to load visits");
  }, [error]);

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
    { label: "Total",       value: filterData?.stats.total      ?? 0, filter: "",            icon: ClipboardList, color: "text-[#25488e]",  iconBg: "bg-[#eef2f9]" },
    { label: "Pending",     value: filterData?.stats.pending    ?? 0, filter: "PENDING",     icon: Clock,         color: "text-amber-600",  iconBg: "bg-amber-50" },
    { label: "In Progress", value: filterData?.stats.inProgress ?? 0, filter: "IN_PROGRESS", icon: TrendingUp,    color: "text-[#25488e]",  iconBg: "bg-[#eef2f9]" },
    { label: "Closed",      value: filterData?.stats.closed     ?? 0, filter: "CLOSED",      icon: CheckCircle2,  color: "text-green-600",  iconBg: "bg-green-50" },
  ], [filterData]);

  return (
    <div className="space-y-5 animate-in">
      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold text-[#0f1829]">All Visits</h1>
        <p className="text-[#8896a9] text-sm mt-1">Monitor and manage all audit field visits</p>
      </div>

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {statCards.map((s) => {
          const Icon = s.icon;
          const isActive = statusFilter === s.filter;
          return (
            <button
              key={s.label}
              onClick={() => setStatusFilter(prev => prev === s.filter ? "" : s.filter)}
              className={cn(
                "bg-white border rounded-xl px-4 py-4 text-left transition-all press-effect card-hover",
                isActive
                  ? "border-[#25488e]/40 ring-2 ring-[#25488e]/10"
                  : "border-[#e2e7f0] hover:border-[#25488e]/20 hover:shadow-sm"
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-[#8896a9] font-semibold uppercase tracking-wide">{s.label}</p>
                <div className={cn("p-1.5 rounded-lg", s.iconBg)}>
                  <Icon className={cn("w-3.5 h-3.5", s.color)} />
                </div>
              </div>
              <p className={cn("text-2xl font-bold tabular-nums", s.color)}>{s.value}</p>
              {isActive && (
                <p className="text-xs text-[#25488e] font-semibold mt-1.5">Active filter</p>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Filters ── */}
      <div className="bg-white border border-[#e2e7f0] rounded-xl p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8896a9]" />
            <input
              type="text"
              placeholder="Search visit number, client, or executive..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-[#f8f9fc] border border-[#e2e7f0] rounded-lg text-sm text-[#0f1829] placeholder-[#8896a9] focus:outline-none focus:ring-2 focus:ring-[#25488e]/20 focus:border-[#25488e] transition-all"
            />
          </div>

          {/* Dropdowns */}
          <div className="flex gap-2 flex-wrap">
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#8896a9]" />
              <select
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                className="pl-8 pr-3 py-2.5 bg-[#f8f9fc] border border-[#e2e7f0] rounded-lg text-sm text-[#0f1829] focus:outline-none focus:ring-2 focus:ring-[#25488e]/20 focus:border-[#25488e] transition-all appearance-none"
              >
                <option value="">All Clients</option>
                {filterData?.clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#8896a9]" />
              <select
                value={executiveFilter}
                onChange={(e) => setExecutiveFilter(e.target.value)}
                className="pl-8 pr-3 py-2.5 bg-[#f8f9fc] border border-[#e2e7f0] rounded-lg text-sm text-[#0f1829] focus:outline-none focus:ring-2 focus:ring-[#25488e]/20 focus:border-[#25488e] transition-all appearance-none"
              >
                <option value="">All Executives</option>
                {filterData?.executives.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* ── Results count ── */}
      {!isLoading && (
        <p className="text-xs text-[#8896a9]">
          Showing{" "}
          <span className="text-[#0f1829] font-semibold">{filteredVisits.length}</span>
          {" "}of{" "}
          <span className="text-[#0f1829] font-semibold">{visits.length}</span>
          {" "}visits
        </p>
      )}

      {/* ── Content ── */}
      {isLoading ? (
        <>
          {!isDesktop && (
            <div className="md:hidden space-y-3">
              {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
            </div>
          )}
          {isDesktop && (
            <div className="hidden md:block">
              <SkeletonTable rows={6} />
            </div>
          )}
        </>
      ) : filteredVisits.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 bg-white border border-[#e2e7f0] rounded-xl text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#f1f4f9] flex items-center justify-center mb-4">
            <Building2 className="w-8 h-8 text-[#c8d2e0]" />
          </div>
          <p className="text-base font-semibold text-[#0f1829]">No visits found</p>
          <p className="text-sm text-[#8896a9] mt-1.5">
            {searchTerm ? "Try a different search term" : "Adjust your filters to see results"}
          </p>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          {!isDesktop && (
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
          )}

          {/* Desktop table */}
          {isDesktop && (
          <div className="hidden md:block bg-white border border-[#e2e7f0] rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#e2e7f0] bg-[#f8f9fc]">
                    {["Visit #", "Client", "Executive", "Date", "Status", "Progress", "CF", "Actions"].map((h) => (
                      <th key={h} className="text-left text-[11px] font-bold text-[#8896a9] uppercase tracking-wider px-5 py-3.5">
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
          )}
        </>
      )}

      {/* Reassign modal */}
      <ReassignVisitModal
        visit={reassignVisit ? {
          id: reassignVisit.id,
          visitNumber: reassignVisit.visitNumber,
          executiveId: reassignVisit.executiveId,
          executive: { name: reassignVisit.executive.name },
          scheduledDate: reassignVisit.scheduledDate,
        } : null}
        executives={filterData?.executives.map((e) => ({ id: e.id, name: e.name })) ?? []}
        onClose={() => setReassignVisit(null)}
        onSuccess={refreshVisits}
      />
    </div>
  );
}
