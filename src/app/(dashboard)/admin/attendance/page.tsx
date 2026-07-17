"use client";

import { useState, useEffect, useCallback } from "react";
import { Users, Clock, AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils/utils";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { useLiveQuery, fetchJSON } from "@/lib/hooks/useLiveQuery";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Executive { id: string; name: string; email: string }
interface AttendanceRecord {
  id: string;
  date: string;
  punchIn: string;
  punchOut: string | null;
  workingMinutes: number | null;
  isLate: boolean;
  executive: Executive;
}
interface AttendanceData {
  records: AttendanceRecord[];
  executives: Executive[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
  });
}
function fmtMinutes(min: number) {
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function AdminAttendancePage() {
  const [dateFilter, setDateFilter] = useState(
    () => new Date().toISOString().split("T")[0]
  );
  const [execFilter, setExecFilter] = useState("");

  const fetchData = useCallback(async () => {
    const params = new URLSearchParams();
    if (dateFilter) params.set("date", dateFilter);
    if (execFilter) params.set("executiveId", execFilter);
    return fetchJSON<AttendanceData>(`/api/admin/attendance?${params.toString()}`);
  }, [dateFilter, execFilter]);

  // Attendance is the ONE page with a hard cross-user live-sync requirement:
  // when an executive punches in, the admin view must flip Absent → Present
  // without a manual reload. 60s is the minimum allowed poll interval; the
  // background refetch is silent (no skeleton flash). No other page polls.
  const { data, loading, refresh } = useLiveQuery(fetchData, { intervalMs: 60000 });

  // Build absent list — executives with no record on selected date
  const presentIds = new Set(data?.records.map((r) => r.executive.id) ?? []);
  const absentExecs = (data?.executives ?? []).filter((e) => !presentIds.has(e.id));

  const presentCount = data?.records.filter((r) => r.punchIn).length ?? 0;
  const lateCount    = data?.records.filter((r) => r.isLate).length ?? 0;
  const absentCount  = absentExecs.length;

  return (
    <div className="animate-in space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0f1829]">Attendance</h1>
          <p className="text-sm text-[#8896a9] mt-0.5">Executive daily attendance overview</p>
        </div>
        <button onClick={refresh} disabled={loading}
          className="p-2 rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#8896a9] transition-colors disabled:opacity-50">
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
        </button>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap gap-3">
        <input
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="border border-[#e2e7f0] rounded-lg px-3 py-2 text-sm text-[#0f1829] bg-white focus:outline-none focus:ring-2 focus:ring-[#25488e]/30"
        />
        <select
          value={execFilter}
          onChange={(e) => setExecFilter(e.target.value)}
          className="border border-[#e2e7f0] rounded-lg px-3 py-2 text-sm text-[#0f1829] bg-white focus:outline-none focus:ring-2 focus:ring-[#25488e]/30"
        >
          <option value="">All Executives</option>
          {(data?.executives ?? []).map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
      </div>

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Present", value: presentCount, color: "text-green-600", bg: "bg-green-50", Icon: Users },
          { label: "Late",    value: lateCount,    color: "text-amber-600", bg: "bg-amber-50",  Icon: AlertCircle },
          { label: "Absent",  value: absentCount,  color: "text-red-600",   bg: "bg-red-50",    Icon: Clock },
        ].map(({ label, value, color, bg, Icon }) => (
          <div key={label} className="bg-white border border-[#e2e7f0] rounded-xl p-4">
            <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center mb-2", bg)}>
              <Icon className={cn("w-4 h-4", color)} />
            </div>
            <p className={cn("text-xl font-bold tabular-nums", color)}>{value}</p>
            <p className="text-xs text-[#8896a9] font-medium mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* ── Records table ── */}
      <div className="bg-white border border-[#e2e7f0] rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-[#e2e7f0]">
          <h2 className="text-base font-bold text-[#0f1829]">
            Attendance Records
          </h2>
          <p className="text-sm text-[#8896a9]">
            {dateFilter
              ? new Date(dateFilter).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })
              : "Last 7 days"}
          </p>
        </div>
        {loading ? (
          <div className="p-4"><SkeletonTable rows={5} /></div>
        ) : (data?.records.length ?? 0) === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <Clock className="w-10 h-10 text-[#c8d2e0] mb-3" />
            <p className="text-sm font-medium text-[#4a5568]">No attendance records</p>
            <p className="text-xs text-[#8896a9] mt-1">No executives have punched in for the selected date/filter</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-[#f8f9fc] border-b border-[#e2e7f0]">
                  {["Executive", "Punch In", "Punch Out", "Working Hours", "Status"].map((h) => (
                    <th key={h} className="text-left text-xs font-semibold text-[#8896a9] px-5 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data!.records.map((rec) => (
                  <tr key={rec.id} className="border-b border-[#f1f4f9] hover:bg-[#f8f9fc] transition-colors">
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-semibold text-[#0f1829]">{rec.executive.name}</p>
                      <p className="text-xs text-[#8896a9]">{rec.executive.email}</p>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-[#0f1829] tabular-nums">{fmtTime(rec.punchIn)}</td>
                    <td className="px-5 py-3.5 text-sm text-[#0f1829] tabular-nums">
                      {rec.punchOut ? fmtTime(rec.punchOut) : <span className="text-[#8896a9]">—</span>}
                    </td>
                    <td className="px-5 py-3.5 text-sm font-medium text-[#0f1829] tabular-nums">
                      {rec.workingMinutes != null ? fmtMinutes(rec.workingMinutes) : <span className="text-[#8896a9]">In progress</span>}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={cn(
                        "text-[11px] font-bold px-2 py-0.5 rounded-full border",
                        rec.isLate
                          ? "bg-amber-50 text-amber-700 border-amber-200"
                          : "bg-green-50 text-green-700 border-green-200"
                      )}>
                        {rec.isLate ? "Late" : "On Time"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Absent executives ── */}
      {!loading && absentExecs.length > 0 && dateFilter && (
        <div className="bg-white border border-[#e2e7f0] rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-[#e2e7f0]">
            <h2 className="text-base font-bold text-[#0f1829]">Absent Executives</h2>
            <p className="text-sm text-[#8896a9]">No attendance record for selected date</p>
          </div>
          <div className="divide-y divide-[#f1f4f9]">
            {absentExecs.map((exec) => (
              <div key={exec.id} className="flex items-center gap-3 px-5 py-3">
                <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-red-600 font-bold text-sm flex-shrink-0">
                  {exec.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#0f1829]">{exec.name}</p>
                  <p className="text-xs text-[#8896a9]">{exec.email}</p>
                </div>
                <span className="ml-auto text-[11px] font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                  Absent
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
