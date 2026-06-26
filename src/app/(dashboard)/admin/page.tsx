"use client";

import { useState, useEffect, useCallback, useMemo, memo } from "react";
import {
  ClipboardList, Clock, TrendingUp, CheckCircle2,
  RotateCcw, Users, Building2, ChevronRight, RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { Badge, ProgressBadge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SkeletonStat, SkeletonCard, SkeletonTable } from "@/components/ui/Skeleton";
import { ExecutiveDetailModal } from "@/components/admin/ExecutiveDetailModal";
import { formatDate, cn } from "@/lib/utils/utils";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface VisitItem {
  id: string;
  visitNumber: string;
  client: { name: string; code: string };
  executive: { id: string; name: string; email: string };
  status: string;
  scheduledDate: string;
  closedAt?: string | null;
  progress: number;
  totalSubtasks: number;
  completedSubtasks: number;
}

interface Stats {
  summary: {
    total: number;
    pendingCount: number;
    inProgressCount: number;
    closedCount: number;
    carryForwardCount: number;
    completionRate: number;
  };
  pendingVisits: VisitItem[];
  inProgressVisits: VisitItem[];
  closedVisits: VisitItem[];
}

interface Executive {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  isActive: boolean;
  totalVisits: number;
  pendingCount: number;
  inProgressCount: number;
  closedCount: number;
  assignedClients: { id: string; name: string }[];
}

type ActiveTab = "all" | "pending" | "inprogress" | "closed";

// ─── Executive Row (memoized) ──────────────────────────────────────────────────

const ExecutiveRow = memo(function ExecutiveRow({
  exec,
  onSelect,
}: {
  exec: Executive;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(exec.id)}
      className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/50 border border-slate-700/50 hover:border-blue-500/40 hover:bg-slate-800 transition-all text-left group press-effect w-full"
    >
      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
        {exec.name.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-white truncate">{exec.name}</p>
          <Badge variant={exec.isActive ? "active" : "inactive"}>
            {exec.isActive ? "Active" : "Off"}
          </Badge>
        </div>
        <p className="text-xs text-slate-500 mt-0.5">
          <span className="text-amber-400">{exec.pendingCount}</span> pending ·{" "}
          <span className="text-blue-400">{exec.inProgressCount}</span> active ·{" "}
          <span className="text-emerald-400">{exec.closedCount}</span> done
        </p>
      </div>
      <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-blue-400 transition-colors flex-shrink-0" />
    </button>
  );
});

// ─── Visit Row (memoized) ──────────────────────────────────────────────────────

const VisitRow = memo(function VisitRow({ visit }: { visit: VisitItem }) {
  return (
    <Link
      href={`/admin/visits/${visit.id}`}
      className="flex items-center gap-3 sm:gap-4 p-3 rounded-xl hover:bg-slate-800/60 transition-colors group"
    >
      <Building2 className="w-4 h-4 text-slate-600 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-white truncate">{visit.client.name}</p>
          <ProgressBadge progress={visit.progress} />
        </div>
        <p className="text-xs text-slate-500 mt-0.5 truncate">
          {visit.visitNumber} · {visit.executive.name} · {formatDate(new Date(visit.scheduledDate))}
        </p>
        <ProgressBar value={visit.progress} size="sm" className="mt-1.5 max-w-xs" />
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-sm font-bold text-white tabular-nums">{visit.progress}%</p>
        <p className="text-xs text-slate-600">{visit.completedSubtasks}/{visit.totalSubtasks}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-slate-700 group-hover:text-slate-400 flex-shrink-0 hidden sm:block" />
    </Link>
  );
});

// ─── Main Dashboard ────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [stats, setStats]         = useState<Stats | null>(null);
  const [executives, setExecutives] = useState<Executive[]>([]);
  const [loading, setLoading]     = useState(true);
  const [activeTab, setActiveTab] = useState<ActiveTab>("all");
  const [selectedExecId, setSelectedExecId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, execRes] = await Promise.all([
        fetch("/api/admin/stats"),
        fetch("/api/admin/executives"),
      ]);
      const [statsData, execData] = await Promise.all([statsRes.json(), execRes.json()]);
      setStats(statsData);
      setExecutives(execData.executives ?? []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const allVisits = useMemo(
    () => (stats ? [...stats.pendingVisits, ...stats.inProgressVisits, ...stats.closedVisits] : []),
    [stats]
  );

  const displayVisits = useMemo<VisitItem[]>(() => {
    if (activeTab === "pending")    return stats?.pendingVisits    ?? [];
    if (activeTab === "inprogress") return stats?.inProgressVisits ?? [];
    if (activeTab === "closed")     return stats?.closedVisits     ?? [];
    return allVisits.slice(0, 8);
  }, [activeTab, stats, allVisits]);

  const tabConfig = useMemo(() => [
    { key: "all"        as ActiveTab, label: "All",         count: stats?.summary.total           ?? 0, icon: ClipboardList, color: "text-white",       activeClass: "bg-slate-700 text-white" },
    { key: "pending"    as ActiveTab, label: "Pending",     count: stats?.summary.pendingCount    ?? 0, icon: Clock,         color: "text-amber-400",   activeClass: "bg-amber-500/10 text-amber-400 border border-amber-500/20" },
    { key: "inprogress" as ActiveTab, label: "In Progress", count: stats?.summary.inProgressCount ?? 0, icon: TrendingUp,    color: "text-blue-400",    activeClass: "bg-blue-500/10 text-blue-400 border border-blue-500/20" },
    { key: "closed"     as ActiveTab, label: "Closed",      count: stats?.summary.closedCount     ?? 0, icon: CheckCircle2,  color: "text-emerald-400", activeClass: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" },
  ], [stats]);

  const handleSelectExec = useCallback((id: string) => setSelectedExecId(id), []);

  return (
    <div className="space-y-6 animate-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Admin Dashboard</h1>
          <p className="text-slate-500 text-sm mt-0.5">Overview of all audit visits and field activity</p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-all press-effect disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
        </button>
      </div>

      {/* Stat Cards */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <SkeletonStat key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {tabConfig.map(({ key, label, count, icon: Icon, color, activeClass }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={cn(
                "bg-slate-900 border rounded-2xl p-4 sm:p-5 text-left transition-all press-effect card-hover",
                activeTab === key ? "border-slate-600 ring-1 ring-slate-600" : "border-slate-800 hover:border-slate-700"
              )}
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm text-slate-500 font-medium">{label}</p>
                  <p className={cn("text-2xl sm:text-3xl font-bold mt-1", color)}>{count}</p>
                  {key !== "all" && (
                    <p className="text-xs text-slate-600 mt-1">
                      {key === "pending" ? "0% progress" : key === "inprogress" ? "1–99%" : "100% done"}
                    </p>
                  )}
                </div>
                <div className="p-2 sm:p-2.5 rounded-xl bg-slate-800 flex-shrink-0">
                  <Icon className={cn("w-4 h-4 sm:w-5 sm:h-5", color)} />
                </div>
              </div>
              {activeTab === key && (
                <div className={cn("mt-2 text-xs font-semibold px-2 py-0.5 rounded-full inline-flex", activeClass)}>
                  Selected
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Secondary Stats Row */}
      {!loading && stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 flex items-center gap-3 sm:gap-4">
            <div className="p-2.5 rounded-xl bg-orange-500/10 border border-orange-500/20 flex-shrink-0">
              <RotateCcw className="w-5 h-5 text-orange-400" />
            </div>
            <div className="min-w-0">
              <p className="text-xs sm:text-sm text-slate-500">Carry-Forward Items</p>
              <p className="text-xl sm:text-2xl font-bold text-orange-400">{stats.summary.carryForwardCount}</p>
              <Link href="/admin/carry-forward" className="text-xs text-blue-400 hover:text-blue-300 transition-colors">View all →</Link>
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 flex items-center gap-3 sm:gap-4">
            <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 flex-shrink-0">
              <Users className="w-5 h-5 text-purple-400" />
            </div>
            <div className="min-w-0">
              <p className="text-xs sm:text-sm text-slate-500">Field Executives</p>
              <p className="text-xl sm:text-2xl font-bold text-purple-400">{executives.length}</p>
              <Link href="/admin/executives" className="text-xs text-blue-400 hover:text-blue-300 transition-colors">Manage →</Link>
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 flex items-center gap-3 sm:gap-4">
            <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex-shrink-0">
              <CheckCircle2 className="w-5 h-5 text-cyan-400" />
            </div>
            <div className="min-w-0">
              <p className="text-xs sm:text-sm text-slate-500">Completion Rate</p>
              <p className="text-xl sm:text-2xl font-bold text-cyan-400">{stats.summary.completionRate}%</p>
            </div>
          </div>
        </div>
      )}

      {/* Executive Overview */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-white">Executive Overview</h2>
          <Link href="/admin/executives" className="text-xs text-blue-400 hover:text-blue-300 transition-colors">Manage all →</Link>
        </div>
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[...Array(3)].map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : executives.length === 0 ? (
          <div className="text-center py-8 text-slate-600">
            <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No executives yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {executives.map((exec) => (
              <ExecutiveRow key={exec.id} exec={exec} onSelect={handleSelectExec} />
            ))}
          </div>
        )}
      </div>

      {/* Visit Drill-Down */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-white">
              {activeTab === "all"        ? "Recent Visits" :
               activeTab === "pending"    ? "Pending Visits (0%)" :
               activeTab === "inprogress" ? "In Progress (1–99%)" : "Closed Visits (100%)"}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {activeTab === "all"
                ? "Showing latest 8"
                : `${displayVisits.length} visit${displayVisits.length !== 1 ? "s" : ""}`}
            </p>
          </div>
          <Link href="/admin/visits" className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
            View all →
          </Link>
        </div>

        {loading ? (
          <SkeletonTable rows={5} />
        ) : displayVisits.length === 0 ? (
          <div className="text-center py-10">
            <CheckCircle2 className="w-8 h-8 text-slate-700 mx-auto mb-2" />
            <p className="text-slate-500 text-sm">No visits in this category</p>
          </div>
        ) : (
          <div className="space-y-1">
            {displayVisits.map((visit) => (
              <VisitRow key={visit.id} visit={visit} />
            ))}
          </div>
        )}
      </div>

      {/* Executive Detail Modal */}
      <ExecutiveDetailModal
        executiveId={selectedExecId}
        onClose={() => setSelectedExecId(null)}
      />
    </div>
  );
}
