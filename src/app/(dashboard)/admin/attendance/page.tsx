"use client";

import { useState, useCallback } from "react";
import { Users, Clock, AlertCircle, RefreshCw, CalendarDays, TrendingUp, MessageSquareText } from "lucide-react";
import { cn } from "@/lib/utils/utils";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { Modal } from "@/components/ui/Modal";
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
  /** Optional note the executive left when punching out. */
  notes?: string | null;
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
function fmtFullDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata",
  });
}

// ─── Punch-out note popup ────────────────────────────────────────────────────
// Opened from the small note icon next to an executive who left a note.
function PunchOutNoteModal({
  record,
  onClose,
}: {
  record: AttendanceRecord | null;
  onClose: () => void;
}) {
  if (!record) return null;
  return (
    <Modal isOpen onClose={onClose} title="Attendance Note" size="sm">
      <div className="p-5 space-y-4">
        <div className="space-y-2.5">
          {[
            { label: "Executive", value: record.executive.name },
            { label: "Date",      value: fmtFullDate(record.date) },
            { label: "Punch In",  value: fmtTime(record.punchIn) },
            { label: "Punch Out", value: record.punchOut ? fmtTime(record.punchOut) : "—" },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-start justify-between gap-3">
              <span className="text-xs text-[#8896a9] font-semibold flex-shrink-0">{label}</span>
              <span className="text-sm text-[#0f1829] text-right">{value}</span>
            </div>
          ))}
        </div>
        <div className="pt-3 border-t border-[#f1f4f9]">
          <p className="text-xs text-[#8896a9] font-semibold mb-1.5">Notes</p>
          <p className="text-sm text-[#0f1829] whitespace-pre-wrap leading-relaxed bg-[#f8f9fc] border border-[#e2e7f0] rounded-lg px-3 py-2.5">
            {record.notes}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-full py-2.5 rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#4a5568] text-sm font-semibold transition-colors press-effect"
        >
          Close
        </button>
      </div>
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function AdminAttendancePage() {
  const [tab, setTab] = useState<"daily" | "monthly">("daily");

  return (
    <div className="animate-in space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0f1829]">Attendance</h1>
          <p className="text-sm text-[#8896a9] mt-0.5">Executive attendance overview</p>
        </div>
      </div>

      {/* ── Daily / Monthly segmented control ── */}
      <div className="inline-flex p-1 rounded-lg bg-[#f1f4f9] border border-[#e2e7f0]">
        {(["daily", "monthly"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2 rounded-md text-sm font-semibold transition-all press-effect capitalize",
              tab === t ? "bg-white text-[#25488e] shadow-sm" : "text-[#8896a9] hover:text-[#4a5568]"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "daily" ? <DailyAttendanceView /> : <MonthlyAttendanceView />}
    </div>
  );
}

// ─── Daily View ─────────────────────────────────────────────────────────────
function DailyAttendanceView() {
  const [dateFilter, setDateFilter] = useState(
    () => new Date().toISOString().split("T")[0]
  );
  const [execFilter, setExecFilter] = useState("");
  const [noteRecord, setNoteRecord] = useState<AttendanceRecord | null>(null);

  const fetchData = useCallback(async () => {
    const params = new URLSearchParams();
    if (dateFilter) params.set("date", dateFilter);
    if (execFilter) params.set("executiveId", execFilter);
    return fetchJSON<AttendanceData>(`/api/admin/attendance?${params.toString()}`);
  }, [dateFilter, execFilter]);

  // Attendance is the ONE page with a hard cross-user live-sync requirement:
  // when an executive punches in, punches out, or sends a punch-out note, the
  // admin's OPEN screen must reflect it without any interaction — no manual
  // reload, no tab switch. The app has no server push channel (no WebSocket,
  // no SSE), and mutation-driven refresh only ever updates the device that
  // performed the mutation, so a short interval on this one screen is what
  // closes the cross-user gap. 5s keeps it effectively immediate while
  // staying cheap: one small single-day query, and only while an admin
  // actually has this tab open. The refetch is silent (no skeleton flash).
  const { data, loading, refresh } = useLiveQuery(fetchData, {
    intervalMs: 5000,
    allowShortInterval: true,
  });

  // Build absent list — executives with no record on selected date
  const presentIds = new Set(data?.records.map((r) => r.executive.id) ?? []);
  const absentExecs = (data?.executives ?? []).filter((e) => !presentIds.has(e.id));

  const presentCount = data?.records.filter((r) => r.punchIn).length ?? 0;
  const lateCount    = data?.records.filter((r) => r.isLate).length ?? 0;
  const absentCount  = absentExecs.length;

  return (
    <div className="space-y-6">
      <PunchOutNoteModal record={noteRecord} onClose={() => setNoteRecord(null)} />

      <div className="flex justify-end">
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
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold text-[#0f1829]">{rec.executive.name}</p>
                        {rec.notes && (
                          <button
                            type="button"
                            onClick={() => setNoteRecord(rec)}
                            title="View punch-out note"
                            aria-label={`View punch-out note from ${rec.executive.name}`}
                            className="flex-shrink-0 p-1 rounded-md text-[#25488e] bg-[#eef2fb] border border-[#d4ddf5] hover:bg-[#d4ddf5] transition-colors press-effect"
                          >
                            <MessageSquareText className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
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

// ─── Monthly View ────────────────────────────────────────────────────────────
interface MonthlySummaryRow {
  executiveId: string;
  executiveName: string;
  executiveEmail: string;
  presentCount: number;
  absentCount: number;
  leaveCount: number;
  lateCount: number;
  totalWorkingDays: number;
  attendancePercentage: number;
}
interface DailyRow {
  date: string;
  status: "PRESENT" | "ABSENT" | "LEAVE";
  punchIn: string | null;
  punchOut: string | null;
  isLate: boolean;
}
interface MonthlyData {
  month: string;
  executives: Executive[];
  summary: MonthlySummaryRow[];
  daily: DailyRow[];
}

function MonthlyAttendanceView() {
  const [monthFilter, setMonthFilter] = useState(
    () => new Date().toISOString().slice(0, 7)
  );
  const [execFilter, setExecFilter] = useState("");

  const fetchData = useCallback(async () => {
    const params = new URLSearchParams();
    params.set("month", monthFilter);
    if (execFilter) params.set("executiveId", execFilter);
    return fetchJSON<MonthlyData>(`/api/admin/attendance/monthly?${params.toString()}`);
  }, [monthFilter, execFilter]);

  const { data, loading, refresh } = useLiveQuery(fetchData);

  const executives = data?.executives ?? [];
  const summary = data?.summary ?? [];
  const daily = data?.daily ?? [];

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button onClick={refresh} disabled={loading}
          className="p-2 rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#8896a9] transition-colors disabled:opacity-50">
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
        </button>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap gap-3">
        <input
          type="month"
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value)}
          className="border border-[#e2e7f0] rounded-lg px-3 py-2 text-sm text-[#0f1829] bg-white focus:outline-none focus:ring-2 focus:ring-[#25488e]/30"
        />
        <select
          value={execFilter}
          onChange={(e) => setExecFilter(e.target.value)}
          className="border border-[#e2e7f0] rounded-lg px-3 py-2 text-sm text-[#0f1829] bg-white focus:outline-none focus:ring-2 focus:ring-[#25488e]/30"
        >
          <option value="">All Executives</option>
          {executives.map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
      </div>

      {/* ── Per-executive summary ── */}
      <div className="bg-white border border-[#e2e7f0] rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-[#e2e7f0]">
          <h2 className="text-base font-bold text-[#0f1829]">Monthly Summary</h2>
          <p className="text-sm text-[#8896a9]">
            {new Date(`${monthFilter}-01T12:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
          </p>
        </div>
        {loading ? (
          <div className="p-4"><SkeletonTable rows={5} /></div>
        ) : summary.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <CalendarDays className="w-10 h-10 text-[#c8d2e0] mb-3" />
            <p className="text-sm font-medium text-[#4a5568]">No executives found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-[#f8f9fc] border-b border-[#e2e7f0]">
                  {["Executive", "Present", "Absent", "Leave", "Late", "Working Days", "Attendance %"].map((h) => (
                    <th key={h} className="text-left text-xs font-semibold text-[#8896a9] px-5 py-3 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summary.map((row) => (
                  <tr key={row.executiveId} className="border-b border-[#f1f4f9] hover:bg-[#f8f9fc] transition-colors">
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-semibold text-[#0f1829]">{row.executiveName}</p>
                      <p className="text-xs text-[#8896a9]">{row.executiveEmail}</p>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-green-700 font-semibold tabular-nums">{row.presentCount}</td>
                    <td className="px-5 py-3.5 text-sm text-red-600 font-semibold tabular-nums">{row.absentCount}</td>
                    <td className="px-5 py-3.5 text-sm text-amber-600 font-semibold tabular-nums">{row.leaveCount}</td>
                    <td className="px-5 py-3.5 text-sm text-[#0f1829] tabular-nums">{row.lateCount}</td>
                    <td className="px-5 py-3.5 text-sm text-[#0f1829] tabular-nums">{row.totalWorkingDays}</td>
                    <td className="px-5 py-3.5">
                      <span className={cn(
                        "text-[11px] font-bold px-2 py-0.5 rounded-full border",
                        row.attendancePercentage >= 90
                          ? "bg-green-50 text-green-700 border-green-200"
                          : row.attendancePercentage >= 75
                          ? "bg-amber-50 text-amber-700 border-amber-200"
                          : "bg-red-50 text-red-700 border-red-200"
                      )}>
                        {row.attendancePercentage}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Day-by-day breakdown (only when a single executive is selected) ── */}
      {execFilter && daily.length > 0 && (
        <div className="bg-white border border-[#e2e7f0] rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-[#e2e7f0] flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[#25488e]" />
            <h2 className="text-base font-bold text-[#0f1829]">Day-by-Day Breakdown</h2>
          </div>
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-[#f8f9fc]">
                <tr className="border-b border-[#e2e7f0]">
                  {["Date", "Status", "Punch In", "Punch Out"].map((h) => (
                    <th key={h} className="text-left text-xs font-semibold text-[#8896a9] px-5 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {daily.map((d) => (
                  <tr key={d.date} className="border-b border-[#f1f4f9] hover:bg-[#f8f9fc] transition-colors">
                    <td className="px-5 py-3 text-sm text-[#0f1829] tabular-nums">
                      {new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", weekday: "short" })}
                    </td>
                    <td className="px-5 py-3">
                      <span className={cn(
                        "text-[11px] font-bold px-2 py-0.5 rounded-full border",
                        d.status === "PRESENT"
                          ? d.isLate ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-green-50 text-green-700 border-green-200"
                          : d.status === "LEAVE"
                          ? "bg-[#eef2fb] text-[#25488e] border-[#d4ddf5]"
                          : "bg-red-50 text-red-700 border-red-200"
                      )}>
                        {d.status === "PRESENT" && d.isLate ? "Late" : d.status.charAt(0) + d.status.slice(1).toLowerCase()}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm text-[#0f1829] tabular-nums">
                      {d.punchIn ? fmtTime(d.punchIn) : <span className="text-[#8896a9]">—</span>}
                    </td>
                    <td className="px-5 py-3 text-sm text-[#0f1829] tabular-nums">
                      {d.punchOut ? fmtTime(d.punchOut) : <span className="text-[#8896a9]">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
