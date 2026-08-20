"use client";

import { useState, useEffect, useCallback, memo } from "react";
import {
  ChevronLeft, ChevronRight, Plus, RotateCcw, Building2,
  Users, CalendarDays, AlertCircle, CheckCircle2,
} from "lucide-react";
import { cn, formatDate } from "@/lib/utils/utils";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SkeletonCard } from "@/components/ui/Skeleton";
import Link from "next/link";
import toast from "react-hot-toast";
import { useLiveQuery, fetchJSON, revalidateAll } from "@/lib/hooks/useLiveQuery";

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

interface Executive { id: string; name: string; email: string }
interface Client    { id: string; name: string; code: string }

// ─── Helpers ─────────────────────────────────────────────────────────────────
function prevMonday(iso: string): string {
  const d = new Date(iso); d.setUTCDate(d.getUTCDate() - 7); return d.toISOString();
}
function nextMonday(iso: string): string {
  const d = new Date(iso); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString();
}
function isTodayDate(iso: string): boolean {
  const d = new Date(iso), t = new Date();
  return d.getUTCFullYear() === t.getFullYear() && d.getUTCMonth() === t.getMonth() && d.getUTCDate() === t.getDate();
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
  });
}
function dayISO(mondayISO: string, offset: number): string {
  const d = new Date(mondayISO);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().split("T")[0];
}

// ─── Create Visit Modal ────────────────────────────────────────────────────────
interface CreateVisitModalProps {
  prefillDate: string;
  clients: Client[];
  executives: Executive[];
  onClose: () => void;
  onCreated: () => void;
}

function CreateVisitModal({ prefillDate, clients, executives, onClose, onCreated }: CreateVisitModalProps) {
  const [clientId, setClientId]       = useState("");
  const [executiveId, setExecutiveId] = useState("");
  const [scheduledDate, setScheduledDate] = useState(prefillDate);
  const [endDate, setEndDate]         = useState("");
  const [notes, setNotes]             = useState("");
  const [submitting, setSubmitting]   = useState(false);
  const [leaveWarning, setLeaveWarning] = useState("");
  // Solo (default, unchanged behaviour) or Team. `executiveId` doubles as the
  // Team Lead when visitType is TEAM.
  const [visitType, setVisitType]     = useState<"SOLO" | "TEAM">("SOLO");
  const [memberIds, setMemberIds]     = useState<string[]>([]);

  const handleSubmit = async () => {
    if (!clientId || !executiveId || !scheduledDate) {
      toast.error("Please fill all required fields");
      return;
    }
    if (visitType === "TEAM" && memberIds.length === 0) {
      toast.error("Add at least one team member, or switch to a Solo Visit");
      return;
    }
    if (endDate && endDate < scheduledDate) {
      toast.error("End date cannot be before the start date");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId, executiveId, scheduledDate, ...(endDate ? { endDate } : {}), notes,
          visitType, ...(visitType === "TEAM" ? { memberIds } : {}),
        }),
      });
      const json = await res.json() as { error?: string; code?: string };
      if (!res.ok) {
        if (json.code === "LEAVE_CONFLICT") setLeaveWarning(json.error ?? "Leave conflict");
        else toast.error(json.error ?? "Failed to create visit");
        return;
      }
      toast.success("Visit created!");
      onCreated();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen title="Create Visit" onClose={onClose} size="sm" overlayClassName="pb-16 sm:pb-0">
      <div className="p-5 space-y-4">
        {leaveWarning && (
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
            <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">{leaveWarning}</p>
          </div>
        )}
        <div>
          <label className="text-xs font-semibold text-[#4a5568] mb-1 block">Start Date <span className="text-red-500">*</span></label>
          <input type="date" value={scheduledDate}
            onChange={(e) => { setScheduledDate(e.target.value); setLeaveWarning(""); }}
            className="w-full border border-[#e2e7f0] rounded-lg px-3 py-2 text-sm text-[#0f1829] bg-white focus:outline-none focus:ring-2 focus:ring-[#25488e]/30" />
        </div>
        <div>
          <label className="text-xs font-semibold text-[#4a5568] mb-1 block">End Date</label>
          <input type="date" value={endDate} min={scheduledDate || undefined}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full border border-[#e2e7f0] rounded-lg px-3 py-2 text-sm text-[#0f1829] bg-white focus:outline-none focus:ring-2 focus:ring-[#25488e]/30" />
          <p className="text-[11px] text-[#8896a9] mt-1">Carry-forward is generated only after this date passes. Defaults to the start date.</p>
        </div>
        <div>
          <label className="text-xs font-semibold text-[#4a5568] mb-1 block">Client <span className="text-red-500">*</span></label>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}
            className="w-full border border-[#e2e7f0] rounded-lg px-3 py-2 text-sm text-[#0f1829] bg-white focus:outline-none focus:ring-2 focus:ring-[#25488e]/30">
            <option value="">Select a client…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
          </select>
        </div>
        {/* Visit Type — chosen first; it decides whether one executive or a
            team is assigned below. */}
        <div>
          <label className="text-xs font-semibold text-[#4a5568] mb-1 block">Visit Type <span className="text-red-500">*</span></label>
          <div className="flex gap-2">
            {(["SOLO", "TEAM"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { setVisitType(t); setMemberIds([]); setLeaveWarning(""); }}
                className={cn(
                  "flex-1 py-2 rounded-lg text-sm font-semibold border transition-colors",
                  visitType === t
                    ? "bg-[#25488e] text-white border-[#25488e]"
                    : "bg-white text-[#4a5568] border-[#e2e7f0] hover:bg-[#f1f4f9]"
                )}
              >
                {t === "SOLO" ? "Solo Visit" : "Team Visit"}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-[#4a5568] mb-1 block">
            {visitType === "TEAM" ? "Select Team Lead" : "Select Executive"} <span className="text-red-500">*</span>
          </label>
          <select value={executiveId} onChange={(e) => { setExecutiveId(e.target.value); setMemberIds((prev) => prev.filter((id) => id !== e.target.value)); setLeaveWarning(""); }}
            className="w-full border border-[#e2e7f0] rounded-lg px-3 py-2 text-sm text-[#0f1829] bg-white focus:outline-none focus:ring-2 focus:ring-[#25488e]/30">
            <option value="">Select an executive…</option>
            {executives.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        {visitType === "TEAM" && (
          <div>
            <label className="text-xs font-semibold text-[#4a5568] mb-1 block">Add Team Members <span className="text-red-500">*</span></label>
            {/* The Team Lead is filtered out, so the same executive can never
                be selected twice (the API enforces this too). */}
            <div className="border border-[#e2e7f0] rounded-lg divide-y divide-[#f1f4f9] max-h-44 overflow-y-auto">
              {executives.filter((e) => e.id !== executiveId).map((e) => {
                const checked = memberIds.includes(e.id);
                return (
                  <label key={e.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[#f8fafc]">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setMemberIds((prev) => checked ? prev.filter((id) => id !== e.id) : [...prev, e.id]);
                        setLeaveWarning("");
                      }}
                      className="w-4 h-4 accent-[#25488e]"
                    />
                    <span className="text-sm text-[#0f1829]">{e.name}</span>
                  </label>
                );
              })}
              {executives.filter((e) => e.id !== executiveId).length === 0 && (
                <p className="px-3 py-2 text-xs text-[#8896a9]">No other executives available.</p>
              )}
            </div>
            <p className="text-[11px] text-[#8896a9] mt-1">
              {memberIds.length} member{memberIds.length === 1 ? "" : "s"} selected. Only the Team Lead can close a team visit.
            </p>
          </div>
        )}
        <div>
          <label className="text-xs font-semibold text-[#4a5568] mb-1 block">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional visit notes…" rows={2}
            className="w-full border border-[#e2e7f0] rounded-lg px-3 py-2 text-sm text-[#0f1829] bg-white focus:outline-none focus:ring-2 focus:ring-[#25488e]/30 resize-none" />
        </div>
      </div>
      <div className="sticky bottom-0 bg-white px-5 py-4 border-t border-[#e2e7f0] flex gap-3">
        <button onClick={onClose}
          className="flex-1 py-2.5 bg-[#f1f4f9] text-[#4a5568] font-semibold text-sm rounded-xl hover:bg-[#e2e7f0] transition-colors">
          Cancel
        </button>
        <button onClick={handleSubmit} disabled={submitting}
          className="flex-1 py-2.5 bg-[#25488e] hover:bg-[#1e3a72] text-white font-semibold text-sm rounded-xl transition-colors press-effect disabled:opacity-60">
          {submitting ? "Creating…" : "Create Visit"}
        </button>
      </div>
    </Modal>
  );
}

// ─── Reschedule Modal ──────────────────────────────────────────────────────────
interface RescheduleModalProps {
  visit: CalendarVisit;
  onClose: () => void;
  onRescheduled: () => void;
}

function RescheduleModal({ visit, onClose, onRescheduled }: RescheduleModalProps) {
  const [newDate, setNewDate]   = useState("");
  const [reason, setReason]     = useState("");
  // Business rule: rescheduling must NOT silently turn the old visit into a
  // carry-forward. The admin chooses explicitly; default is No.
  const [carryForward, setCarryForward] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [leaveWarning, setLeaveWarning] = useState("");

  const handleSubmit = async () => {
    if (!newDate) { toast.error("Please select a date"); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/visits/${visit.id}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: newDate, reason, carryForward }),
      });
      const json = await res.json() as { error?: string; code?: string };
      if (!res.ok) {
        if (json.code === "LEAVE_CONFLICT") setLeaveWarning(json.error ?? "Leave conflict");
        else toast.error(json.error ?? "Failed to reschedule");
        return;
      }
      toast.success("Visit rescheduled!");
      onRescheduled();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen title="Reschedule Visit" onClose={onClose} size="sm" overlayClassName="pb-16 sm:pb-0">
      <div className="p-5 space-y-4">
        <div className="p-3 bg-[#f8f9fc] rounded-xl border border-[#e2e7f0]">
          <p className="text-xs text-[#8896a9]">Rescheduling</p>
          <p className="text-sm font-semibold text-[#0f1829] mt-0.5">{visit.client.name}</p>
          <p className="text-xs text-[#8896a9]">{visit.visitNumber} · {visit.executive.name}</p>
          <p className="text-xs text-[#8896a9]">Current: {fmtTime(visit.scheduledDate)}</p>
        </div>
        {leaveWarning && (
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
            <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">{leaveWarning}</p>
          </div>
        )}
        <div>
          <label className="text-xs font-semibold text-[#4a5568] mb-1 block">New Date <span className="text-red-500">*</span></label>
          <input type="date" value={newDate}
            onChange={(e) => { setNewDate(e.target.value); setLeaveWarning(""); }}
            className="w-full border border-[#e2e7f0] rounded-lg px-3 py-2 text-sm text-[#0f1829] bg-white focus:outline-none focus:ring-2 focus:ring-[#25488e]/30" />
        </div>
        <div>
          <label className="text-xs font-semibold text-[#4a5568] mb-1 block">Reason</label>
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this being rescheduled?"
            className="w-full border border-[#e2e7f0] rounded-lg px-3 py-2 text-sm text-[#0f1829] bg-white focus:outline-none focus:ring-2 focus:ring-[#25488e]/30" />
        </div>
        <div>
          <label className="text-xs font-semibold text-[#4a5568] mb-1.5 block">Carry Forward</label>
          <div className="flex gap-2">
            {([false, true] as const).map((opt) => (
              <button
                key={String(opt)}
                type="button"
                onClick={() => setCarryForward(opt)}
                className={cn(
                  "flex-1 py-2 rounded-lg text-sm font-semibold border transition-all",
                  carryForward === opt
                    ? opt
                      ? "bg-orange-50 text-[#ff944d] border-orange-300"
                      : "bg-[#eef2fb] text-[#25488e] border-[#adc2e2]"
                    : "bg-[#f8f9fc] text-[#8896a9] border-[#e2e7f0] hover:border-[#c8d2e0] hover:text-[#4a5568]"
                )}
              >
                {opt ? "Yes" : "No"}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-[#8896a9] mt-1.5">
            {carryForward
              ? "The moved visit will be flagged as Carry Forward and appear on the Carry Forward page."
              : "The visit simply moves to the new date — no carry-forward is created."}
          </p>
        </div>
      </div>
      <div className="sticky bottom-0 bg-white px-5 py-4 border-t border-[#e2e7f0] flex gap-3">
        <button onClick={onClose}
          className="flex-1 py-2.5 bg-[#f1f4f9] text-[#4a5568] font-semibold text-sm rounded-xl hover:bg-[#e2e7f0] transition-colors">
          Cancel
        </button>
        <button onClick={handleSubmit} disabled={submitting}
          className="flex-1 py-2.5 bg-[#25488e] hover:bg-[#1e3a72] text-white font-semibold text-sm rounded-xl transition-colors press-effect disabled:opacity-60">
          {submitting ? "Saving…" : "Confirm"}
        </button>
      </div>
    </Modal>
  );
}

// ─── Admin Visit Card ──────────────────────────────────────────────────────────
// memo'd: a week can hold dozens of these, and every card re-rendered whenever
// any unrelated page state changed (week label, exec filter dropdown, the
// delete dialog opening). The props are primitives + stable callbacks, so a
// shallow compare is exact here.
const AdminVisitCard = memo(function AdminVisitCard({
  visit,
  onReschedule,
  onDelete,
}: {
  visit: CalendarVisit;
  onReschedule: (v: CalendarVisit) => void;
  onDelete: (v: CalendarVisit) => void;
}) {
  const statusColors: Record<string, string> = {
    CLOSED:      "border-l-green-500  bg-green-50",
    IN_PROGRESS: "border-l-[#25488e]  bg-[#eef2f9]",
    PENDING:     "border-l-amber-400  bg-amber-50",
  };
  const base = statusColors[visit.displayStatus] ?? "border-l-gray-300 bg-white";

  return (
    <div className={cn("border-l-4 rounded-lg px-3 py-2.5 mb-2 group transition-all", base)}>
      {visit.hasCarryForward && (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#ff944d] bg-orange-100 px-1.5 py-0.5 rounded-full mb-1">
          <RotateCcw className="w-2.5 h-2.5" /> carry-forward
        </span>
      )}
      <p className="text-xs font-semibold text-[#0f1829] leading-tight truncate">{visit.client.name}</p>
      <p className="text-[11px] text-[#8896a9] mt-0.5 truncate">
        {fmtTime(visit.scheduledDate)} · {visit.executive.name}
      </p>
      {/* Admin action row */}
      <div className="flex items-center gap-1.5 mt-1.5">
        <Link href={`/admin/visits/${visit.id}`}
          className="text-[10px] font-semibold text-[#25488e] hover:underline">
          View
        </Link>
        <span className="text-[#c8d2e0]">·</span>
        <button onClick={() => onReschedule(visit)}
          className="text-[10px] font-semibold text-[#800040] hover:underline">
          Reschedule
        </button>
        <span className="text-[#c8d2e0]">·</span>
        <button onClick={() => onDelete(visit)}
          className="text-[10px] font-semibold text-red-600 hover:underline">
          Delete
        </button>
      </div>
    </div>
  );
});

// ─── Desktop Day Column ────────────────────────────────────────────────────────
const DayColumn = memo(function DayColumn({
  day, isToday, onAddVisit, onReschedule, onDelete,
}: {
  day: CalendarDay;
  isToday: boolean;
  onAddVisit: (dateISO: string) => void;
  onReschedule: (v: CalendarVisit) => void;
  onDelete: (v: CalendarVisit) => void;
}) {
  return (
    <div className={cn(
      "min-w-0 rounded-xl border transition-all",
      isToday ? "border-[#25488e] shadow-sm ring-1 ring-[#25488e]/20 bg-white" : "border-[#e2e7f0] bg-[#f8f9fc]"
    )}>
      {/* Day header */}
      <div className={cn(
        "flex items-center justify-between px-2 py-2 rounded-t-xl border-b",
        isToday ? "bg-[#eef2f9] border-[#adc2e2]" : "bg-transparent border-[#e2e7f0]"
      )}>
        <span className={cn("text-[10px] font-bold uppercase tracking-wider", isToday ? "text-[#25488e]" : "text-[#8896a9]")}>
          {day.dayLabel}
        </span>
        <span className={cn("text-sm font-bold", isToday ? "text-[#25488e]" : "text-[#0f1829]")}>
          {day.dayNumber}
        </span>
      </div>

      {/* Visit cards */}
      <div className="p-2 min-h-[80px]">
        {day.visits.length === 0 ? (
          <p className="text-[10px] text-[#c8d2e0] text-center py-3">—</p>
        ) : (
          day.visits.map((v) => (
            <AdminVisitCard key={v.id} visit={v} onReschedule={onReschedule} onDelete={onDelete} />
          ))
        )}
        {/* Add button */}
        <button
          onClick={() => onAddVisit(day.date.split("T")[0])}
          className="w-full mt-1 flex items-center justify-center gap-1 text-[10px] text-[#c8d2e0] hover:text-[#25488e] hover:bg-[#eef2f9] rounded-lg py-1.5 transition-all"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>
    </div>
  );
});

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function AdminCalendarPage() {
  const [weekISO, setWeekISO]     = useState(new Date().toISOString());
  const [execFilter, setExecFilter] = useState("");
  const [executives, setExecutives] = useState<Executive[]>([]);
  const [clients, setClients]       = useState<Client[]>([]);

  // Modal state
  const [showCreate, setShowCreate]           = useState(false);
  const [createPrefillDate, setCreatePrefillDate] = useState("");
  const [rescheduleVisit, setRescheduleVisit] = useState<CalendarVisit | null>(null);
  const [deleteVisit, setDeleteVisit]         = useState<CalendarVisit | null>(null);

  const fetchCalendar = useCallback(async () => {
    const params = new URLSearchParams({ week: weekISO });
    if (execFilter) params.set("executiveId", execFilter);
    return fetchJSON<CalendarData>(`/api/calendar?${params.toString()}`);
  }, [weekISO, execFilter]);

  // Fetch once on mount / week change; refreshed only by explicit mutations. No polling.
  const { data, loading, refresh, setData } = useLiveQuery(fetchCalendar);

  // Fetch clients + executives once. `meta=1` returns ONLY the dropdown
  // options — this used to download every visit with all tasks/subtasks just
  // to fill two <select>s.
  useEffect(() => {
    fetchJSON<{ clients: Client[]; executives: Executive[] }>("/api/admin/visits?meta=1")
      .then(({ clients: c, executives: e }) => { setClients(c); setExecutives(e); })
      .catch(console.error);
  }, []);

  const goToPrev = () => setWeekISO((w) => prevMonday(w));
  const goToNext = () => setWeekISO((w) => nextMonday(w));
  const goToToday = () => setWeekISO(new Date().toISOString());

  const handleAddVisit = useCallback((dateISO: string) => {
    setCreatePrefillDate(dateISO);
    setShowCreate(true);
  }, []);
  // Stable identities so the memo'd day columns / visit cards don't re-render
  // on every keystroke elsewhere on the page.
  const handleReschedule = useCallback((v: CalendarVisit) => setRescheduleVisit(v), []);
  const handleDelete     = useCallback((v: CalendarVisit) => setDeleteVisit(v), []);

  // ── Delete ONE visit occurrence ──────────────────────────────────────────
  // Scoped to this visit's id only — the client, its other visits, its task
  // configuration and its subtask templates are untouched (see the API route
  // and lib/utils/delete-visit.ts).
  //
  // On success the card is removed from the already-loaded week immediately
  // (no full-page reload, no skeleton flash), then revalidateAll() refetches
  // every other mounted live query — admin dashboard, visit lists, client
  // history, carry-forward — so nothing anywhere still shows the deleted
  // visit. The assigned executive's screens pick it up on their next
  // focus/visibility revalidation, which is how this app already syncs
  // across users.
  const confirmDelete = async () => {
    if (!deleteVisit) return;
    const target = deleteVisit;
    try {
      const res = await fetch(`/api/admin/visits/${target.id}?allowClosed=1`, { method: "DELETE" });
      const json = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) {
        toast.error((json as { error?: string }).error ?? "Failed to delete visit");
        return;
      }
      setDeleteVisit(null);
      setData((prev) =>
        prev
          ? { ...prev, days: prev.days.map((d) => ({ ...d, visits: d.visits.filter((v) => v.id !== target.id) })) }
          : prev
      );
      toast.success(`Visit deleted for ${target.client.name}`);
      revalidateAll();
    } catch {
      toast.error("Error deleting visit");
    }
  };

  const totalVisits = data?.days.reduce((s, d) => s + d.visits.length, 0) ?? 0;
  const closedCount = data?.days.reduce((s, d) => s + d.visits.filter((v) => v.displayStatus === "CLOSED").length, 0) ?? 0;
  const carryCount  = data?.days.reduce((s, d) => s + d.visits.filter((v) => v.hasCarryForward).length, 0) ?? 0;

  return (
    <div className="animate-in space-y-5">
      {/* Modals */}
      {showCreate && (
        <CreateVisitModal
          prefillDate={createPrefillDate}
          clients={clients}
          executives={executives}
          onClose={() => setShowCreate(false)}
          onCreated={refresh}
        />
      )}
      {rescheduleVisit && (
        <RescheduleModal
          visit={rescheduleVisit}
          onClose={() => setRescheduleVisit(null)}
          onRescheduled={refresh}
        />
      )}
      {/* Delete confirmation — names the client and the exact visit date so
          the wrong occurrence can't be deleted by accident. */}
      <ConfirmDialog
        isOpen={!!deleteVisit}
        title="Delete Visit"
        danger
        confirmLabel="Delete Visit"
        onCancel={() => setDeleteVisit(null)}
        onConfirm={confirmDelete}
        message={deleteVisit ? (
          <div className="space-y-2">
            <p>
              Delete the visit for{" "}
              <span className="font-semibold text-[#0f1829]">{deleteVisit.client.name}</span>{" "}
              on{" "}
              <span className="font-semibold text-[#0f1829]">{formatDate(deleteVisit.scheduledDate)}</span>?
            </p>
            <p className="text-xs text-[#8896a9]">
              {deleteVisit.visitNumber} · {deleteVisit.executive.name}
            </p>
            <p className="text-xs">
              Only this visit and its own tasks, subtasks and history are removed. The client,
              its other visits and its task configuration are not affected.
            </p>
            {deleteVisit.displayStatus === "CLOSED" && (
              <p className="text-xs font-semibold text-red-600">
                This visit is already closed — its completed audit record will be permanently removed.
              </p>
            )}
            {deleteVisit.hasCarryForward && (
              <p className="text-xs font-semibold text-[#ff944d]">
                This visit carries forwarded work. Those carried items are removed with it and will
                not reappear on another visit.
              </p>
            )}
          </div>
        ) : ""}
      />


      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-[#25488e]" />
          <div>
            <h1 className="text-xl font-bold text-[#0f1829]">
              {loading ? "Calendar" : `Week ${data?.weekNumber} · ${data?.monthLabel}`}
            </h1>
            <p className="text-xs text-[#8896a9]">Click Visit to open · Reschedule to move · + to add</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Executive filter */}
          <select
            value={execFilter}
            onChange={(e) => setExecFilter(e.target.value)}
            className="border border-[#e2e7f0] rounded-lg px-3 py-1.5 text-sm text-[#0f1829] bg-white focus:outline-none focus:ring-2 focus:ring-[#25488e]/30"
          >
            <option value="">All Executives</option>
            {executives.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <button
            onClick={() => handleAddVisit(data?.days[0]?.date.split("T")[0] ?? "")}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#25488e] hover:bg-[#1e3a72] text-white text-xs font-semibold rounded-lg transition-colors press-effect"
          >
            <Plus className="w-3.5 h-3.5" /> New Visit
          </button>
          <button onClick={goToToday}
            className="text-xs font-semibold text-[#25488e] bg-[#eef2f9] px-3 py-1.5 rounded-lg hover:bg-[#d9e4f7] transition-colors">
            Today
          </button>
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="flex items-center gap-4 text-[11px] text-[#8896a9] flex-wrap">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500" />Done</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#25488e]" />In Progress</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400" />Planned</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#ff944d]" />Carry Forward</span>
      </div>

      {/* ── Week navigation ── */}
      <div className="flex items-center gap-2">
        <button onClick={goToPrev}
          className="p-2 rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#8896a9] transition-colors">
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
        <button onClick={goToNext}
          className="p-2 rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#8896a9] transition-colors">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* ── Calendar grid: full week, no horizontal scroll ── */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i}><SkeletonCard /></div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
          {data?.days.map((day) => (
            <DayColumn
              key={day.index}
              day={day}
              isToday={isTodayDate(day.date)}
              onAddVisit={handleAddVisit}
              onReschedule={handleReschedule}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* ── Summary row ── */}
      {!loading && data && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Visits this week", value: totalVisits, color: "text-[#25488e]", Icon: Building2 },
            { label: "Completed",        value: closedCount, color: "text-green-600",  Icon: CheckCircle2 },
            { label: "Carry Forwards",   value: carryCount,  color: "text-[#ff944d]",  Icon: RotateCcw },
          ].map(({ label, value, color, Icon }) => (
            <div key={label} className="bg-white border border-[#e2e7f0] rounded-xl p-4 flex items-center gap-3">
              <Icon className={cn("w-4 h-4 flex-shrink-0", color)} />
              <div>
                <p className={cn("text-lg font-bold tabular-nums", color)}>{value}</p>
                <p className="text-[11px] text-[#8896a9]">{label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Executive schedule overview (desktop) ── */}
      {!loading && data && executives.length > 0 && !execFilter && (
        <div className="hidden md:block bg-white border border-[#e2e7f0] rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-[#e2e7f0] flex items-center gap-2">
            <Users className="w-4 h-4 text-[#25488e]" />
            <h2 className="text-sm font-bold text-[#0f1829]">Executive Load This Week</h2>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {executives.slice(0, 6).map((exec) => {
                const execVisits = data.days.flatMap((d) =>
                  d.visits.filter((v) => v.executive.id === exec.id)
                );
                const done = execVisits.filter((v) => v.displayStatus === "CLOSED").length;
                return (
                  <button
                    key={exec.id}
                    onClick={() => setExecFilter(exec.id)}
                    className="flex items-center gap-3 p-3 rounded-lg bg-[#f8f9fc] hover:bg-[#eef2f9] transition-colors text-left"
                  >
                    <div className="w-8 h-8 rounded-full bg-[#25488e] flex items-center justify-center text-white font-bold text-xs flex-shrink-0">
                      {exec.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[#0f1829] truncate">{exec.name}</p>
                      <p className="text-[11px] text-[#8896a9]">{execVisits.length} visits · {done} done</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
