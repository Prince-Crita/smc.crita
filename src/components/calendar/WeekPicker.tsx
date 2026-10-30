"use client";

import { useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/utils";

// ─── Week picker for the Calendar's week navigation ──────────────────────────
// Clicking the week range opens a compact month view; choosing any day shows
// the Monday–Sunday week containing it. Month and year can be changed with the
// arrows or picked directly, so any period is a couple of clicks away. The
// Calendar grid and its Task History view share this one control.
//
// DATE BOUNDARIES. GET /api/calendar derives the week from the UTC calendar
// day of its `week` parameter (Monday 00:00:00.000 UTC through Sunday
// 23:59:59.999 UTC, matching how visit dates are stored). Every value this
// module hands back is therefore the chosen calendar date at 12:00 UTC: that
// instant falls on the same calendar day in every timezone, so the server
// always lands on the intended week. `new Date().toISOString()` does not —
// between 00:00 and 05:30 IST it is still the previous UTC day.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar date y-m-d (month 0-based) as an ISO instant at 12:00 UTC. */
function dateAnchorISO(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day, 12, 0, 0, 0)).toISOString();
}

/** Today's calendar date (the user's own clock) as a week anchor. */
export function todayWeekAnchor(): string {
  const now = new Date();
  return dateAnchorISO(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Monday 00:00 UTC of the week containing `iso` — the same rule as the API. */
function mondayUTC(iso: string): Date {
  const d = new Date(iso);
  const dow = d.getUTCDay(); // 0 = Sunday
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

const shortDate = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** "Oct 26 – Nov 1" for the week containing `iso` (the existing label format). */
export function weekRangeLabel(iso: string): string {
  const monday = mondayUTC(iso);
  const sunday = new Date(monday.getTime() + 6 * DAY_MS);
  return `${shortDate(monday)} – ${shortDate(sunday)}`;
}

export function WeekPicker({
  weekISO,
  onSelect,
}: {
  /** Any instant inside the week currently shown. */
  weekISO: string;
  /** Receives the chosen date as a 12:00-UTC ISO anchor. */
  onSelect: (anchorISO: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const shownMonday = useMemo(() => mondayUTC(weekISO), [weekISO]);
  const [viewYear, setViewYear] = useState(shownMonday.getUTCFullYear());
  const [viewMonth, setViewMonth] = useState(shownMonday.getUTCMonth());

  const today = new Date();
  const currentYear = today.getFullYear();
  const todayKey = Date.UTC(currentYear, today.getMonth(), today.getDate());

  // Whole Monday-first weeks covering the month in view.
  const weeks = useMemo(() => {
    const first = new Date(Date.UTC(viewYear, viewMonth, 1));
    const lead = (first.getUTCDay() + 6) % 7; // days before the 1st back to Monday
    const start = new Date(first.getTime() - lead * DAY_MS);
    const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
    const rows = Math.ceil((lead + daysInMonth) / 7);
    return Array.from({ length: rows }, (_, w) =>
      Array.from({ length: 7 }, (_, d) => new Date(start.getTime() + (w * 7 + d) * DAY_MS))
    );
  }, [viewYear, viewMonth]);

  const years = useMemo(() => {
    const from = Math.min(currentYear, viewYear) - 10;
    const to = Math.max(currentYear, viewYear) + 10;
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }, [currentYear, viewYear]);

  const handleOpenChange = (next: boolean) => {
    // Always open on the month of the week being shown.
    if (next) {
      setViewYear(shownMonday.getUTCFullYear());
      setViewMonth(shownMonday.getUTCMonth());
    }
    setOpen(next);
  };

  const stepMonth = (delta: number) => {
    const d = new Date(Date.UTC(viewYear, viewMonth + delta, 1));
    setViewYear(d.getUTCFullYear());
    setViewMonth(d.getUTCMonth());
  };

  const choose = (day: Date) => {
    onSelect(dateAnchorISO(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Choose a week"
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-medium text-[#0f1829] hover:bg-[#f1f4f9] transition-colors"
        >
          <CalendarDays className="w-3.5 h-3.5 text-[#25488e]" />
          {weekRangeLabel(weekISO)}
          <ChevronDown className="w-3.5 h-3.5 text-[#8896a9]" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="center"
          sideOffset={6}
          className="z-[80] w-72 bg-white border border-[#e2e7f0] rounded-xl shadow-xl p-3"
        >
          {/* Month / year */}
          <div className="flex items-center gap-1.5 mb-2">
            <button
              type="button"
              onClick={() => stepMonth(-1)}
              aria-label="Previous month"
              className="p-1.5 rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#8896a9] transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <select
              value={viewMonth}
              onChange={(e) => setViewMonth(Number(e.target.value))}
              aria-label="Month"
              className="flex-1 min-w-0 border border-[#e2e7f0] rounded-lg px-2 py-1 text-sm text-[#0f1829] bg-white focus:outline-none focus:ring-2 focus:ring-[#25488e]/30"
            >
              {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
            </select>
            <select
              value={viewYear}
              onChange={(e) => setViewYear(Number(e.target.value))}
              aria-label="Year"
              className="w-20 border border-[#e2e7f0] rounded-lg px-2 py-1 text-sm text-[#0f1829] bg-white focus:outline-none focus:ring-2 focus:ring-[#25488e]/30"
            >
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button
              type="button"
              onClick={() => stepMonth(1)}
              aria-label="Next month"
              className="p-1.5 rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#8896a9] transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Weekday header */}
          <div className="grid grid-cols-7 mb-1">
            {WEEKDAYS.map((d) => (
              <span key={d} className="text-[10px] font-bold uppercase tracking-wider text-[#8896a9] text-center py-1">
                {d}
              </span>
            ))}
          </div>

          {/* Weeks — any day picks its whole week */}
          <div className="space-y-0.5">
            {weeks.map((week) => {
              const isShownWeek = week[0].getTime() === shownMonday.getTime();
              return (
                <div
                  key={week[0].getTime()}
                  className={cn(
                    "grid grid-cols-7 rounded-lg transition-colors",
                    isShownWeek ? "bg-[#eef2f9]" : "hover:bg-[#f8f9fc]"
                  )}
                >
                  {week.map((day) => {
                    const inMonth = day.getUTCMonth() === viewMonth;
                    const isToday = day.getTime() === todayKey;
                    return (
                      <button
                        key={day.getTime()}
                        type="button"
                        onClick={() => choose(day)}
                        aria-label={day.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}
                        className={cn(
                          "h-8 text-xs rounded-lg tabular-nums transition-colors hover:bg-[#d9e4f7]",
                          isShownWeek ? "text-[#25488e] font-semibold" : inMonth ? "text-[#0f1829]" : "text-[#c8d2e0]",
                          isToday && "ring-1 ring-[#25488e] font-bold"
                        )}
                      >
                        {day.getUTCDate()}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#f1f4f9]">
            <span className="text-[11px] text-[#8896a9]">Pick any day to view its week</span>
            <button
              type="button"
              onClick={() => { onSelect(todayWeekAnchor()); setOpen(false); }}
              className="text-xs font-semibold text-[#25488e] bg-[#eef2f9] px-2.5 py-1 rounded-lg hover:bg-[#d9e4f7] transition-colors"
            >
              This week
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
