"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, CalendarDays, Building2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils/utils";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { useLiveQuery, fetchJSON } from "@/lib/hooks/useLiveQuery";

// ─── Types ────────────────────────────────────────────────────────────────────
interface CalendarVisit {
  id: string;
  visitNumber: string;
  status: string;
  displayStatus: string;
  scheduledDate: string;
  client: { name: string; code: string };
  executive: { id: string; name: string };
  progress: number;
  totalSubtasks: number;
  completedSubtasks: number;
  hasCarryForward: boolean;
}

interface CalendarDay {
  index: number;
  date: string;
  dayLabel: string;
  dayNumber: number;
  visits: CalendarVisit[];
}

interface CalendarData {
  weekNumber: number;
  monthLabel: string;
  monday: string;
  days: CalendarDay[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function prevMonday(mondayISO: string): string {
  const d = new Date(mondayISO);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString();
}
function nextMonday(mondayISO: string): string {
  const d = new Date(mondayISO);
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString();
}
function isTodayDate(dateISO: string): boolean {
  const d = new Date(dateISO);
  const t = new Date();
  return (
    d.getUTCFullYear() === t.getFullYear() &&
    d.getUTCMonth() === t.getMonth() &&
    d.getUTCDate() === t.getDate()
  );
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
}

// ─── Visit Card ───────────────────────────────────────────────────────────────
function VisitCard({ visit }: { visit: CalendarVisit }) {
  const statusColors: Record<string, string> = {
    CLOSED:      "border-l-green-500  bg-green-50",
    IN_PROGRESS: "border-l-[#25488e]  bg-[#eef2f9]",
    PENDING:     "border-l-amber-400  bg-amber-50",
  };
  const base = statusColors[visit.displayStatus] ?? "border-l-gray-300 bg-white";

  return (
    <Link href={`/executive/visits/${visit.id}`}>
      <div
        className={cn(
          "border-l-4 rounded-lg px-3 py-2.5 mb-2 hover:shadow-sm transition-all press-effect",
          base
        )}
      >
        {visit.hasCarryForward && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#ff944d] bg-orange-100 px-1.5 py-0.5 rounded-full mb-1">
            <RotateCcw className="w-2.5 h-2.5" /> carry-forward
          </span>
        )}
        <p className="text-xs font-semibold text-[#0f1829] leading-tight truncate">
          {visit.client.name}
        </p>
        <p className="text-[11px] text-[#8896a9] mt-0.5">
          {fmtTime(visit.scheduledDate)}
          {visit.totalSubtasks > 0 && ` · ${visit.totalSubtasks} tasks`}
        </p>
        {visit.displayStatus === "CLOSED" && (
          <p className="text-[10px] text-green-600 font-medium mt-0.5">Closed ✓</p>
        )}
      </div>
    </Link>
  );
}

// ─── Day Column ───────────────────────────────────────────────────────────────
function DayColumn({ day, isToday }: { day: CalendarDay; isToday: boolean }) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border p-2 transition-all",
        isToday
          ? "border-[#25488e] bg-white shadow-sm ring-1 ring-[#25488e]/20"
          : "border-[#e2e7f0] bg-[#f8f9fc]"
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <span className={cn("text-[10px] font-bold uppercase tracking-wider", isToday ? "text-[#25488e]" : "text-[#8896a9]")}>
          {day.dayLabel}
        </span>
        <span className={cn("text-sm font-bold", isToday ? "text-[#25488e]" : "text-[#0f1829]")}>
          {day.dayNumber}
        </span>
      </div>

      {day.visits.length === 0 ? (
        <p className="text-[10px] text-[#c8d2e0] text-center py-3">—</p>
      ) : (
        day.visits.map((v) => <VisitCard key={v.id} visit={v} />)
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function CalendarPage() {
  const [weekISO, setWeekISO] = useState<string>(new Date().toISOString());

  const fetchCalendar = useCallback(async () => {
    return fetchJSON<CalendarData>(`/api/calendar?week=${encodeURIComponent(weekISO)}`);
  }, [weekISO]);

  // Fetch once on mount / week change; refreshed only by explicit mutations. No polling.
  const { data, loading } = useLiveQuery(fetchCalendar);

  const goToPrev = () => setWeekISO((w) => prevMonday(w));
  const goToNext = () => setWeekISO((w) => nextMonday(w));
  const goToToday = () => setWeekISO(new Date().toISOString());

  return (
    <div className="animate-in space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-[#25488e]" />
          <div>
            <h1 className="text-xl font-bold text-[#0f1829]">
              {loading ? "Calendar" : `Week ${data?.weekNumber} · ${data?.monthLabel}`}
            </h1>
            <p className="text-xs text-[#8896a9]">Tap a visit to open it</p>
          </div>
        </div>
        <button
          onClick={goToToday}
          className="text-xs font-semibold text-[#25488e] bg-[#eef2f9] px-3 py-1.5 rounded-lg hover:bg-[#d9e4f7] transition-colors"
        >
          Today
        </button>
      </div>

      {/* ── Legend ── */}
      <div className="flex items-center gap-4 text-[11px] text-[#8896a9]">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500" />Done</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#25488e]" />In Progress</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400" />Planned</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#ff944d]" />Carry</span>
      </div>

      {/* ── Week navigation ── */}
      <div className="flex items-center gap-2">
        <button
          onClick={goToPrev}
          className="p-2 rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#8896a9] transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 text-center">
          {!loading && data && (
            <p className="text-sm font-medium text-[#0f1829]">
              {new Date(data.days[0].date).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
              {" – "}
              {new Date(data.days[6].date).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
            </p>
          )}
        </div>
        <button
          onClick={goToNext}
          className="p-2 rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#8896a9] transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* ── Calendar Grid: full week, no horizontal scroll ── */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i}>
              <SkeletonCard />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
          {data?.days.map((day) => (
            <DayColumn
              key={day.index}
              day={day}
              isToday={isTodayDate(day.date)}
            />
          ))}
        </div>
      )}

      {/* ── Summary ── */}
      {!loading && data && (
        <div className="bg-white border border-[#e2e7f0] rounded-xl p-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#eef2fb] flex items-center justify-center flex-shrink-0">
            <Building2 className="w-4 h-4 text-[#25488e]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#0f1829]">
              {data.days.reduce((s, d) => s + d.visits.length, 0)} visits this week
            </p>
            <p className="text-xs text-[#8896a9]">
              {data.days.reduce((s, d) => s + d.visits.filter((v) => v.displayStatus === "CLOSED").length, 0)} completed ·{" "}
              {data.days.reduce((s, d) => s + d.visits.filter((v) => v.hasCarryForward).length, 0)} with carry-forward
            </p>
          </div>
        </div>
      )}

      {/* ── Threshold note ── */}
      <p className="text-[11px] text-[#8896a9] text-center pb-2">
        Threshold check runs per week — moving a visit out of the week prompts a carry-forward reason.
      </p>
    </div>
  );
}
