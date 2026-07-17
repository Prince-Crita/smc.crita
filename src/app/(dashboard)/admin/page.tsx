"use client";

import { useState, useEffect, useCallback, useMemo, memo } from "react";
import dynamic from "next/dynamic";
import {
  ClipboardList, Clock, TrendingUp, CheckCircle2,
  RotateCcw, Users, Building2, ChevronRight, RefreshCw,
  AlertCircle, BarChart2,
} from "lucide-react";
import Link from "next/link";
import { Badge, ProgressBadge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SkeletonStat, SkeletonCard, SkeletonTable } from "@/components/ui/Skeleton";
import { ExecutiveDetailModal } from "@/components/admin/ExecutiveDetailModal";
import { formatDate, cn } from "@/lib/utils/utils";
import { useLiveQuery, fetchJSON } from "@/lib/hooks/useLiveQuery";

// ─── Recharts — dynamically imported to avoid SSR issues ─────────────────────
import { Cell } from "recharts";
const ResponsiveContainer  = dynamic(() => import("recharts").then((m) => m.ResponsiveContainer),  { ssr: false });
const BarChart             = dynamic(() => import("recharts").then((m) => m.BarChart),             { ssr: false });
const Bar                  = dynamic(() => import("recharts").then((m) => m.Bar),                  { ssr: false });
const XAxis                = dynamic(() => import("recharts").then((m) => m.XAxis),                { ssr: false });
const YAxis                = dynamic(() => import("recharts").then((m) => m.YAxis),                { ssr: false });
const CartesianGrid        = dynamic(() => import("recharts").then((m) => m.CartesianGrid),        { ssr: false });
const Tooltip              = dynamic(() => import("recharts").then((m) => m.Tooltip),              { ssr: false });
const PieChart             = dynamic(() => import("recharts").then((m) => m.PieChart),             { ssr: false });
const Pie                  = dynamic(() => import("recharts").then((m) => m.Pie),                  { ssr: false });

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
    missedCount: number;
    carryForwardCount: number;
    rescheduledCount: number;
    mdMeetingNoCount?: number;
    completionRate: number;
  };
  pendingVisits: VisitItem[];
  inProgressVisits: VisitItem[];
  closedVisits: VisitItem[];
  overdueVisits: VisitItem[];
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
  missedCount: number;
  assignedClients: { id: string; name: string }[];
}

type ActiveTab = "all" | "pending" | "inprogress" | "closed";

const CHART_COLORS = {
  assigned:     "#ca8a04",
  completed:    "#16a34a",
  missed:       "#dc2626",
  pending:      "#ea580c",
  inprogress:   "#25488e",
  carryForward: "#800040",
};

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
      className="flex items-center gap-3 p-3 rounded-xl bg-white border border-[#e2e7f0] hover:border-[#25488e]/40 hover:bg-[#f8f9fc] transition-all text-left group press-effect w-full"
    >
      <div className="w-9 h-9 rounded-full bg-[#25488e] flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
        {exec.name.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-[#0f1829] truncate">{exec.name}</p>
          <Badge variant={exec.isActive ? "active" : "inactive"}>
            {exec.isActive ? "Active" : "Off"}
          </Badge>
        </div>
        <p className="text-xs text-[#8896a9] mt-0.5">
          <span className="text-amber-600 font-medium">{exec.pendingCount}</span> pending ·{" "}
          <span className="text-[#25488e] font-medium">{exec.inProgressCount}</span> active ·{" "}
          <span className="text-green-600 font-medium">{exec.closedCount}</span> done
        </p>
      </div>
      <ChevronRight className="w-3.5 h-3.5 text-[#c8d2e0] group-hover:text-[#25488e] transition-colors flex-shrink-0" />
    </button>
  );
});

const VisitRow = memo(function VisitRow({ visit }: { visit: VisitItem }) {
  return (
    <Link
      href={`/admin/visits/${visit.id}`}
      className="flex items-center gap-3 sm:gap-4 px-5 py-4 hover:bg-[#f8f9fc] transition-colors group border-b border-[#f1f4f9] last:border-b-0"
    >
      <div className="w-8 h-8 rounded-lg bg-[#f1f4f9] flex items-center justify-center flex-shrink-0">
        <Building2 className="w-4 h-4 text-[#8896a9]" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-[#0f1829] truncate">{visit.client.name}</p>
          <ProgressBadge progress={visit.progress} />
        </div>
        <p className="text-xs text-[#8896a9] mt-0.5 truncate">
          {visit.visitNumber} · {visit.executive.name} · {formatDate(new Date(visit.scheduledDate))}
        </p>
        <ProgressBar value={visit.progress} size="sm" className="mt-1.5 max-w-xs" />
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-sm font-bold text-[#0f1829] tabular-nums">{visit.progress}%</p>
        <p className="text-xs text-[#8896a9]">{visit.completedSubtasks}/{visit.totalSubtasks}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-[#c8d2e0] group-hover:text-[#25488e] flex-shrink-0 hidden sm:block" />
    </Link>
  );
});

function MobileExecRankItem({
  exec,
  rank,
  onSelect,
}: {
  exec: Executive;
  rank: number;
  onSelect: (id: string) => void;
}) {
  const completionPct = exec.totalVisits > 0
    ? Math.round((exec.closedCount / exec.totalVisits) * 100)
    : 0;

  return (
    <button
      onClick={() => onSelect(exec.id)}
      className="w-full flex items-center gap-3 p-3 rounded-xl bg-[#f8f9fc] hover:bg-[#eef2f9] transition-all text-left press-effect group"
    >
      <div className={cn(
        "w-7 h-7 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0",
        rank === 1 ? "bg-amber-400 text-white" :
        rank === 2 ? "bg-[#c8d2e0] text-[#4a5568]" :
        rank === 3 ? "bg-orange-300 text-white" :
                     "bg-[#e2e7f0] text-[#8896a9]"
      )}>
        {rank}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <p className="text-sm font-semibold text-[#0f1829] truncate">{exec.name}</p>
          <span className="text-sm font-bold text-[#25488e] tabular-nums flex-shrink-0">{completionPct}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-[#e2e7f0] overflow-hidden">
          <div
            className="h-full rounded-full bg-[#25488e] transition-all duration-500"
            style={{ width: `${completionPct}%` }}
          />
        </div>
        <p className="text-[11px] text-[#8896a9] mt-1">
          {exec.closedCount} completed · {exec.totalVisits} assigned
        </p>
      </div>
    </button>
  );
}

function MobileVisitCard({ visit }: { visit: VisitItem }) {
  const statusMeta: Record<string, { label: string; color: string; bg: string }> = {
    PENDING:      { label: "Pending",     color: "text-amber-700",  bg: "bg-amber-50 border-amber-200"  },
    IN_PROGRESS:  { label: "In Progress", color: "text-[#25488e]",  bg: "bg-[#eef2f9] border-[#adc2e2]" },
    CLOSED:       { label: "Closed",      color: "text-green-700",  bg: "bg-green-50 border-green-200"  },
    CARRY_FORWARD:{ label: "Carry Fwd",   color: "text-[#ff944d]",  bg: "bg-orange-50 border-orange-200"},
  };
  const meta = statusMeta[visit.status] ?? statusMeta["PENDING"];

  return (
    <Link href={`/admin/visits/${visit.id}`} className="block">
      <div className="bg-white border border-[#e2e7f0] rounded-xl p-4 hover:border-[#25488e]/40 hover:shadow-sm transition-all press-effect">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#0f1829] truncate">{visit.client.name}</p>
            <p className="text-xs text-[#8896a9] mt-0.5">{visit.visitNumber} · {visit.executive.name}</p>
          </div>
          <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0", meta.bg, meta.color)}>
            {meta.label}
          </span>
        </div>
        <ProgressBar value={visit.progress} size="sm" className="mb-1.5" />
        <div className="flex items-center justify-between text-xs text-[#8896a9]">
          <span>{formatDate(new Date(visit.scheduledDate))}</span>
          <span className="font-semibold text-[#0f1829]">{visit.progress}%</span>
        </div>
      </div>
    </Link>
  );
}

function DonutLegend({ items }: { items: { label: string; value: number; color: string; fill: string }[] }) {
  const total = items.reduce((s, i) => s + i.value, 0);
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: item.color }} />
          <div className="min-w-0">
            <p className="text-[11px] text-[#8896a9] truncate">{item.label}</p>
            <p className="text-xs font-bold text-[#0f1829]">
              {item.value}
              <span className="font-normal text-[#8896a9] ml-1">
                ({total > 0 ? Math.round((item.value / total) * 100) : 0}%)
              </span>
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AdminDashboard() {
  const [activeTab, setActiveTab]       = useState<ActiveTab>("all");
  const [selectedExecId, setSelectedExecId] = useState<string | null>(null);

  const fetchDashboardData = useCallback(async () => {
    const [statsData, execData, pendingLeavesData] = await Promise.all([
      fetchJSON<Stats>("/api/admin/stats"),
      fetchJSON<{ executives?: Executive[] }>("/api/admin/executives"),
      fetchJSON<{ leaves?: unknown[] }>("/api/admin/leaves?status=PENDING"),
    ]);
    return {
      stats: statsData as Stats,
      executives: (execData.executives ?? []) as Executive[],
      pendingLeavesCount: (pendingLeavesData.leaves ?? []).length as number,
    };
  }, []);

  // Fetch once on mount; refreshed only by explicit mutations. No polling.
  const { data: dashboardData, loading, refresh: fetchData } = useLiveQuery(fetchDashboardData);
  const stats = dashboardData?.stats ?? null;
  const executives = dashboardData?.executives ?? [];
  const pendingLeavesCount = dashboardData?.pendingLeavesCount ?? 0;

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
    { key: "all"        as ActiveTab, label: "All Visits",  count: stats?.summary.total           ?? 0, icon: ClipboardList },
    { key: "pending"    as ActiveTab, label: "Pending",     count: stats?.summary.pendingCount    ?? 0, icon: Clock },
    { key: "inprogress" as ActiveTab, label: "In Progress", count: stats?.summary.inProgressCount ?? 0, icon: TrendingUp },
    { key: "closed"     as ActiveTab, label: "Closed",      count: stats?.summary.closedCount     ?? 0, icon: CheckCircle2 },
  ], [stats]);

  const handleSelectExec = useCallback((id: string) => setSelectedExecId(id), []);

  const barData = useMemo(() =>
    executives.slice(0, 8).map((e) => ({
      name:      e.name.split(" ")[0],
      Assigned:  e.totalVisits,
      Completed: e.closedCount,
      Missed:    e.missedCount ?? 0,
    })),
  [executives]);

  const donutAllItems = useMemo(() => {
    if (!stats) return [];
    return [
      { label: "Completed",    value: stats.summary.closedCount,       color: CHART_COLORS.completed,    fill: CHART_COLORS.completed    },
      { label: "In Progress",  value: stats.summary.inProgressCount,   color: CHART_COLORS.inprogress,   fill: CHART_COLORS.inprogress   },
      { label: "Pending",      value: stats.summary.pendingCount,      color: CHART_COLORS.pending,      fill: CHART_COLORS.pending      },
      { label: "Missed",       value: stats.summary.missedCount ?? 0,  color: CHART_COLORS.missed,       fill: CHART_COLORS.missed       },
      { label: "Carry Forward",value: stats.summary.carryForwardCount, color: CHART_COLORS.carryForward, fill: CHART_COLORS.carryForward },
    ];
  }, [stats]);

  const donutItems = useMemo(
    () => donutAllItems.filter((item) => item.value > 0),
    [donutAllItems]
  );

  const top5Execs = useMemo(() =>
    [...executives]
      .sort((a, b) => {
        const pctA = a.totalVisits > 0 ? a.closedCount / a.totalVisits : 0;
        const pctB = b.totalVisits > 0 ? b.closedCount / b.totalVisits : 0;
        return pctB - pctA;
      })
      .slice(0, 5),
  [executives]);

  // Today's Alerts — used on both desktop and mobile
  const alerts = useMemo(() => {
    if (!stats) return [];
    const items: { type: string; msg: string }[] = [];
    const mc = stats.summary.missedCount ?? 0;
    const pc = stats.summary.pendingCount;
    const ic = stats.summary.inProgressCount;
    const cf = stats.summary.carryForwardCount;
    const rs = stats.summary.rescheduledCount ?? 0;
    const md = stats.summary.mdMeetingNoCount ?? 0;
    const lp = pendingLeavesCount;
    if (md > 0) items.push({ type: "error",   msg: `${md} visit${md !== 1 ? "s" : ""} closed without MD Meeting` });
    if (mc > 0) items.push({ type: "error",   msg: `${mc} overdue visit${mc !== 1 ? "s" : ""} not yet closed` });
    if (pc > 0) items.push({ type: "warning", msg: `${pc} visit${pc !== 1 ? "s" : ""} pending action` });
    if (ic > 0) items.push({ type: "info",    msg: `${ic} visit${ic !== 1 ? "s" : ""} currently in progress` });
    if (cf > 0) items.push({ type: "accent",  msg: `${cf} subtask${cf !== 1 ? "s" : ""} carried forward` });
    if (lp > 0) items.push({ type: "warning", msg: `${lp} leave request${lp !== 1 ? "s" : ""} awaiting your approval` });
    if (rs > 0) items.push({ type: "info",    msg: `${rs} visit${rs !== 1 ? "s" : ""} rescheduled` });
    // NOTE: "Threshold reached" alert intentionally omitted — no threshold value
    // is defined anywhere in the codebase (only a static UI sentence on the
    // executive calendar page). Adding one here would mean fabricating a
    // business rule; skip until a real threshold is specified.
    return items.slice(0, 6);
  }, [stats, pendingLeavesCount]);

  const upcomingVisits = useMemo(() => allVisits.slice(0, 5), [allVisits]);

  return (
    <div className="animate-in">
      <ExecutiveDetailModal
        executiveId={selectedExecId}
        onClose={() => setSelectedExecId(null)}
      />

      <div className="hidden md:block space-y-6">

        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#0f1829]">Admin Dashboard</h1>
            <p className="text-sm text-[#8896a9] mt-0.5">Overview of all visits, executives, and completion metrics</p>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-2 rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#8896a9] hover:text-[#0f1829] transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
        </div>

        {!loading && alerts.length > 0 && (
          <div className="bg-white border border-[#e2e7f0] rounded-xl overflow-hidden shadow-sm">
            <div className="px-5 py-3.5 border-b border-[#f1f4f9] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <h2 className="text-sm font-bold text-[#0f1829]">Today&apos;s Alerts</h2>
              <span className="ml-auto text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                {alerts.length}
              </span>
            </div>
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 p-4">
              {alerts.map((alert, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex items-start gap-2.5 px-3.5 py-3 rounded-xl border text-sm font-medium",
                    alert.type === "error"   ? "bg-red-50 text-red-800 border-red-200" :
                    alert.type === "warning" ? "bg-amber-50 text-amber-800 border-amber-200" :
                    alert.type === "accent"  ? "bg-orange-50 text-orange-800 border-orange-200" :
                                               "bg-[#eef2fb] text-[#25488e] border-[#adc2e2]"
                  )}
                >
                  <span className={cn(
                    "w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5",
                    alert.type === "error"   ? "bg-red-500" :
                    alert.type === "warning" ? "bg-amber-500" :
                    alert.type === "accent"  ? "bg-[#ff944d]" : "bg-[#25488e]"
                  )} />
                  <span className="text-xs leading-snug">{alert.msg}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonStat key={i} />)}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-4">
            {tabConfig.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              const colorMap: Record<ActiveTab, { iconBg: string; iconColor: string; countColor: string }> = {
                all:        { iconBg: "bg-[#eef2fb]", iconColor: "text-[#25488e]", countColor: "text-[#25488e]" },
                pending:    { iconBg: "bg-amber-50",  iconColor: "text-amber-600", countColor: "text-amber-600" },
                inprogress: { iconBg: "bg-[#eef2fb]", iconColor: "text-[#25488e]", countColor: "text-[#25488e]" },
                closed:     { iconBg: "bg-green-50",  iconColor: "text-green-600", countColor: "text-green-600" },
              };
              const c = colorMap[tab.key];
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    "bg-white border rounded-xl p-5 text-left transition-all hover:shadow-md",
                    isActive
                      ? "border-[#25488e] ring-2 ring-[#25488e]/20 shadow-sm"
                      : "border-[#e2e7f0] hover:border-[#c8d2e0]"
                  )}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", c.iconBg)}>
                      <Icon className={cn("w-4.5 h-4.5", c.iconColor)} />
                    </div>
                    {isActive && (
                      <span className="text-[10px] font-semibold text-[#25488e] bg-[#eef2fb] px-2 py-0.5 rounded-full">
                        Active
                      </span>
                    )}
                  </div>
                  <p className={cn("text-2xl font-bold tabular-nums", c.countColor)}>{tab.count}</p>
                  <p className="text-xs font-medium text-[#8896a9] mt-0.5">{tab.label}</p>
                </button>
              );
            })}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => <SkeletonStat key={i} />)}
          </div>
        ) : stats && (
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white border border-[#e2e7f0] rounded-xl p-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center flex-shrink-0">
                <RotateCcw className="w-5 h-5 text-[#ff944d]" />
              </div>
              <div>
                <p className="text-xl font-bold text-[#ff944d] tabular-nums">{stats.summary.carryForwardCount}</p>
                <p className="text-xs text-[#8896a9] font-medium">Carry Forward</p>
                <p className="text-[11px] text-[#8896a9] mt-0.5">Visits rolled from prior period</p>
              </div>
            </div>
            <div className="bg-white border border-[#e2e7f0] rounded-xl p-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-[#eef2fb] flex items-center justify-center flex-shrink-0">
                <Users className="w-5 h-5 text-[#25488e]" />
              </div>
              <div>
                <p className="text-xl font-bold text-[#25488e] tabular-nums">{executives.length}</p>
                <p className="text-xs text-[#8896a9] font-medium">Executives</p>
                <p className="text-[11px] text-[#8896a9] mt-0.5">
                  {executives.filter((e) => e.isActive).length} currently active
                </p>
              </div>
            </div>
            <div className="bg-white border border-[#e2e7f0] rounded-xl p-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0">
                <TrendingUp className="w-5 h-5 text-green-600" />
              </div>
              <div className="flex-1">
                <p className="text-xl font-bold text-green-600 tabular-nums">
                  {stats.summary.completionRate.toFixed(1)}%
                </p>
                <p className="text-xs text-[#8896a9] font-medium">Completion Rate</p>
                <div className="mt-1.5 h-1.5 rounded-full bg-[#f1f4f9] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-green-500 transition-all duration-500"
                    style={{ width: `${Math.min(100, stats.summary.completionRate)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-2 gap-6">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : stats && (
          <div className="grid grid-cols-2 gap-6">

            <div className="bg-white border border-[#e2e7f0] rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-[#e2e7f0] flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-[#0f1829]">Staff Performance</h2>
                  <p className="text-xs text-[#8896a9] mt-0.5">Assigned vs Completed visits per executive</p>
                </div>
                <div className="w-8 h-8 rounded-lg bg-[#eef2fb] flex items-center justify-center">
                  <BarChart2 className="w-4 h-4 text-[#25488e]" />
                </div>
              </div>
              <div className="p-5">
                {executives.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-center">
                    <BarChart2 className="w-8 h-8 text-[#c8d2e0] mb-2" />
                    <p className="text-sm text-[#8896a9]">No executive data yet</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-4 mb-4 flex-wrap">
                      <div className="flex items-center gap-1.5">
                          <span className="w-3 h-3 rounded-sm inline-block" style={{ background: CHART_COLORS.assigned }} />
                          <span className="text-xs text-[#8896a9]">Assigned</span>
                        </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded-sm bg-[#16a34a] inline-block" />
                        <span className="text-xs text-[#8896a9]">Completed</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded-sm bg-[#dc2626] inline-block" />
                        <span className="text-xs text-[#8896a9]">Missed</span>
                      </div>
                    </div>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={barData} barSize={14} barGap={4}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f4f9" vertical={false} />
                        <XAxis
                          dataKey="name"
                          tick={{ fontSize: 11, fill: "#8896a9" }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: "#8896a9" }}
                          axisLine={false}
                          tickLine={false}
                          allowDecimals={false}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "#fff",
                            border: "1px solid #e2e7f0",
                            borderRadius: "10px",
                            fontSize: "12px",
                            boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
                          }}
                          cursor={{ fill: "#f8f9fc" }}
                        />
                        <Bar dataKey="Assigned"  fill={CHART_COLORS.assigned} radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Completed" fill="#16a34a" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Missed"    fill="#dc2626" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </>
                )}
              </div>
            </div>

            <div className="bg-white border border-[#e2e7f0] rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-[#e2e7f0] flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-[#0f1829]">Task Distribution</h2>
                  <p className="text-xs text-[#8896a9] mt-0.5">Breakdown by visit status</p>
                </div>
                <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 text-[#ff944d]" />
                </div>
              </div>
              <div className="p-5">
                {stats.summary.total === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-center">
                    <TrendingUp className="w-8 h-8 text-[#c8d2e0] mb-2" />
                    <p className="text-sm text-[#8896a9]">No visit data yet</p>
                  </div>
                ) : (
                  <div className="flex items-center gap-6">
                    <div className="flex-shrink-0">
                      <ResponsiveContainer width={180} height={180}>
                        <PieChart>
                          <Pie
                            data={donutItems}
                            cx="50%"
                            cy="50%"
                            innerRadius={52}
                            outerRadius={80}
                            paddingAngle={3}
                            dataKey="value"
                            strokeWidth={0}
                          >
                            {donutItems.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.fill} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{
                              background: "#fff",
                              border: "1px solid #e2e7f0",
                              borderRadius: "10px",
                              fontSize: "12px",
                            }}
                            formatter={(value: number, name: string) => [value, name]}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex-1 space-y-3">
                      {donutAllItems.map((item) => (
                        <div key={item.label} className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: item.fill }} />
                            <span className="text-xs text-[#4a5568] truncate">{item.label}</span>
                          </div>
                          <span className="text-sm font-bold text-[#0f1829] tabular-nums">{item.value}</span>
                        </div>
                      ))}
                      <div className="pt-2 border-t border-[#f1f4f9] flex items-center justify-between">
                        <span className="text-xs font-semibold text-[#8896a9]">Total</span>
                        <span className="text-sm font-bold text-[#0f1829] tabular-nums">{stats.summary.total}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-1">
            <div className="bg-white border border-[#e2e7f0] rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-[#e2e7f0] flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-[#0f1829]">Executive Overview</h2>
                  <p className="text-sm text-[#8896a9]">Click a row to view details</p>
                </div>
                <div className="w-8 h-8 rounded-lg bg-[#eef2fb] flex items-center justify-center">
                  <Users className="w-4 h-4 text-[#25488e]" />
                </div>
              </div>
              <div className="p-4 space-y-2">
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
                ) : executives.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <div className="w-12 h-12 rounded-xl bg-[#f1f4f9] flex items-center justify-center mb-3">
                      <Users className="w-6 h-6 text-[#c8d2e0]" />
                    </div>
                    <p className="text-sm font-medium text-[#4a5568]">No executives found</p>
                    <p className="text-xs text-[#8896a9] mt-1">Executives will appear here once added</p>
                  </div>
                ) : (
                  executives.map((exec) => (
                    <ExecutiveRow key={exec.id} exec={exec} onSelect={handleSelectExec} />
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="xl:col-span-2">
            <div className="bg-white border border-[#e2e7f0] rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-[#e2e7f0]">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="text-lg font-bold text-[#0f1829]">Visits</h2>
                    <p className="text-sm text-[#8896a9]">
                      {activeTab === "all"
                        ? `Showing recent ${displayVisits.length} of ${stats?.summary.total ?? 0}`
                        : `${displayVisits.length} visit${displayVisits.length !== 1 ? "s" : ""} in this view`}
                    </p>
                  </div>
                  <Link
                    href="/admin/visits"
                    className="text-xs font-semibold text-[#25488e] hover:text-[#1e3a72] flex items-center gap-1 transition-colors"
                  >
                    View all <ChevronRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
                <div className="flex gap-1 p-1 bg-[#f8f9fc] rounded-lg border border-[#e2e7f0]">
                  {tabConfig.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.key;
                    return (
                      <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={cn(
                          "flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-semibold transition-all",
                          isActive
                            ? "bg-white text-[#25488e] shadow-sm border border-[#e2e7f0]"
                            : "text-[#8896a9] hover:text-[#4a5568] hover:bg-white/60"
                        )}
                      >
                        <Icon className="w-3.5 h-3.5 hidden sm:block" />
                        <span>{tab.label}</span>
                        <span className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded-full font-bold",
                          isActive ? "bg-[#eef2fb] text-[#25488e]" : "bg-[#e2e7f0] text-[#8896a9]"
                        )}>
                          {tab.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {loading ? (
                <div className="p-4"><SkeletonTable rows={5} /></div>
              ) : displayVisits.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                  <div className="w-12 h-12 rounded-xl bg-[#f1f4f9] flex items-center justify-center mb-3">
                    <ClipboardList className="w-6 h-6 text-[#c8d2e0]" />
                  </div>
                  <p className="text-sm font-medium text-[#4a5568]">No visits found</p>
                  <p className="text-xs text-[#8896a9] mt-1">
                    {activeTab === "all"
                      ? "No visits have been created yet"
                      : `No ${activeTab === "inprogress" ? "in-progress" : activeTab} visits at the moment`}
                  </p>
                </div>
              ) : (
                <div>
                  {displayVisits.map((visit) => (
                    <VisitRow key={visit.id} visit={visit} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="md:hidden space-y-5">

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-[#0f1829]">Dashboard</h1>
            <p className="text-xs text-[#8896a9] mt-0.5">Admin overview</p>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-2 rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#8896a9] transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonStat key={i} />)}
          </div>
        ) : stats && (
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "All Visits",       value: stats.summary.total,            color: "text-[#25488e]", bg: "bg-[#eef2fb]",  iconColor: "text-[#25488e]", Icon: ClipboardList },
              { label: "Pending",          value: stats.summary.pendingCount,     color: "text-amber-600", bg: "bg-amber-50",   iconColor: "text-amber-500", Icon: Clock },
              { label: "In Progress",      value: stats.summary.inProgressCount,  color: "text-[#25488e]", bg: "bg-blue-50",    iconColor: "text-[#25488e]", Icon: TrendingUp },
              { label: "Closed",           value: stats.summary.closedCount,      color: "text-green-600", bg: "bg-green-50",   iconColor: "text-green-500", Icon: CheckCircle2 },
              { label: "Carry Forward",    value: stats.summary.carryForwardCount,color: "text-[#ff944d]", bg: "bg-orange-50",  iconColor: "text-[#ff944d]", Icon: RotateCcw },
              { label: "Executives",       value: executives.length,              color: "text-[#800040]", bg: "bg-[#fff0f6]",  iconColor: "text-[#800040]", Icon: Users },
            ].map(({ label, value, color, bg, iconColor, Icon }) => (
              <div key={label} className="bg-white border border-[#e2e7f0] rounded-xl p-4">
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center mb-2", bg)}>
                  <Icon className={cn("w-4 h-4", iconColor)} />
                </div>
                <p className={cn("text-xl font-bold tabular-nums", color)}>{value}</p>
                <p className="text-xs text-[#8896a9] font-medium mt-0.5">{label}</p>
              </div>
            ))}
            <div className="col-span-2 bg-white border border-[#e2e7f0] rounded-xl p-4 flex items-center gap-4">
              <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
                <TrendingUp className="w-4 h-4 text-green-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs text-[#8896a9] font-medium">Completion Rate</p>
                  <p className="text-lg font-bold text-green-600 tabular-nums">{stats.summary.completionRate.toFixed(1)}%</p>
                </div>
                <div className="h-1.5 rounded-full bg-[#f1f4f9] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-green-500 transition-all duration-700"
                    style={{ width: `${Math.min(100, stats.summary.completionRate)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {!loading && alerts.length > 0 && (
          <div className="bg-white border border-[#e2e7f0] rounded-xl overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-[#f1f4f9] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <h2 className="text-sm font-bold text-[#0f1829]">Today&apos;s Alerts</h2>
            </div>
            <div className="p-3 space-y-2">
              {alerts.map((alert, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm",
                    alert.type === "warning" ? "bg-amber-50 text-amber-800 border border-amber-100" :
                    alert.type === "accent"  ? "bg-orange-50 text-orange-700 border border-orange-100" :
                                               "bg-[#eef2f9] text-[#25488e] border border-[#adc2e2]/30"
                  )}
                >
                  <span className={cn(
                    "w-1.5 h-1.5 rounded-full flex-shrink-0",
                    alert.type === "warning" ? "bg-amber-500" :
                    alert.type === "accent"  ? "bg-[#ff944d]" : "bg-[#25488e]"
                  )} />
                  <span className="font-medium text-xs">{alert.msg}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-white border border-[#e2e7f0] rounded-xl overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-[#f1f4f9] flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-[#0f1829]">Staff Performance</h2>
              <p className="text-xs text-[#8896a9]">Top 5 by completion rate</p>
            </div>
            <div className="w-7 h-7 rounded-lg bg-[#eef2fb] flex items-center justify-center">
              <BarChart2 className="w-3.5 h-3.5 text-[#25488e]" />
            </div>
          </div>
          <div className="p-3 space-y-2">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
            ) : top5Execs.length === 0 ? (
              <div className="py-8 text-center">
                <Users className="w-8 h-8 text-[#c8d2e0] mx-auto mb-2" />
                <p className="text-sm text-[#8896a9]">No executives yet</p>
              </div>
            ) : (
              top5Execs.map((exec, index) => (
                <MobileExecRankItem
                  key={exec.id}
                  exec={exec}
                  rank={index + 1}
                  onSelect={handleSelectExec}
                />
              ))
            )}
          </div>
          <div className="px-4 py-3 border-t border-[#f1f4f9]">
            <Link
              href="/admin/executives"
              className="flex items-center justify-center gap-1.5 text-xs font-semibold text-[#25488e] hover:text-[#1e3a72] transition-colors"
            >
              View Full Analytics <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        <div className="bg-white border border-[#e2e7f0] rounded-xl overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-[#f1f4f9] flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-[#0f1829]">Task Distribution</h2>
              <p className="text-xs text-[#8896a9]">Breakdown by status</p>
            </div>
            <div className="w-7 h-7 rounded-lg bg-orange-50 flex items-center justify-center">
              <TrendingUp className="w-3.5 h-3.5 text-[#ff944d]" />
            </div>
          </div>
          <div className="p-4">
            {loading || !stats || stats.summary.total === 0 ? (
              <div className="py-8 text-center">
                <TrendingUp className="w-8 h-8 text-[#c8d2e0] mx-auto mb-2" />
                <p className="text-sm text-[#8896a9]">No visit data yet</p>
              </div>
            ) : (
              <>
                <div className="flex justify-center">
                  <ResponsiveContainer width={200} height={180}>
                    <PieChart>
                      <Pie
                        data={donutItems}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={3}
                        dataKey="value"
                        strokeWidth={0}
                      >
                        {donutItems.map((entry, index) => (
                          <Cell key={`mob-cell-${index}`} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background: "#fff",
                          border: "1px solid #e2e7f0",
                          borderRadius: "10px",
                          fontSize: "12px",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <DonutLegend items={donutAllItems} />
              </>
            )}
          </div>
        </div>

        <div className="bg-white border border-[#e2e7f0] rounded-xl overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-[#f1f4f9] flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-[#0f1829]">Upcoming Visits</h2>
              <p className="text-xs text-[#8896a9]">Most recent visits</p>
            </div>
            <div className="w-7 h-7 rounded-lg bg-[#eef2fb] flex items-center justify-center">
              <ClipboardList className="w-3.5 h-3.5 text-[#25488e]" />
            </div>
          </div>
          <div className="p-3 space-y-2">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
            ) : upcomingVisits.length === 0 ? (
              <div className="py-8 text-center">
                <ClipboardList className="w-8 h-8 text-[#c8d2e0] mx-auto mb-2" />
                <p className="text-sm text-[#8896a9]">No visits yet</p>
              </div>
            ) : (
              upcomingVisits.map((visit) => (
                <MobileVisitCard key={visit.id} visit={visit} />
              ))
            )}
          </div>
          <div className="px-4 py-3 border-t border-[#f1f4f9]">
            <Link
              href="/admin/visits"
              className="flex items-center justify-center gap-1.5 text-xs font-semibold text-[#25488e] hover:text-[#1e3a72] transition-colors"
            >
              View All Visits <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        <div className="pb-2">
          <Link href="/admin/executives">
            <div className="w-full bg-[#25488e] hover:bg-[#1e3a72] transition-colors rounded-xl px-5 py-4 flex items-center justify-between group press-effect shadow-sm">
              <div>
                <p className="text-sm font-bold text-white">View Performance Report</p>
                <p className="text-xs text-white/70 mt-0.5">Full analytics across all executives</p>
              </div>
              <ChevronRight className="w-5 h-5 text-white/70 group-hover:text-white transition-colors" />
            </div>
          </Link>
        </div>

      </div>
    </div>
  );
}
