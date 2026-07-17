"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Clock, LogIn, LogOut, Flame, CalendarDays, AlertCircle, CheckCircle2,
  ChevronRight, X, RotateCcw, Users, Bell, ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils/utils";
import toast from "react-hot-toast";
import { useLiveQuery, fetchJSON } from "@/lib/hooks/useLiveQuery";

// --- Types ----------------------------------------------------------------------
interface AttendanceRecord {
  id: string; date: string; punchIn: string; punchOut: string | null;
  workingMinutes: number | null; isLate: boolean;
}
interface UpcomingVisit {
  id: string; visitNumber: string; scheduledDate: string;
  client: { name: string };
}
interface LeaveRequest {
  id: string; date: string; reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  adminComment: string | null; createdAt: string;
}
interface AttendanceData {
  today: AttendanceRecord | null; history: AttendanceRecord[]; streak: number;
}
interface LeavesData {
  leaves: LeaveRequest[]; upcomingVisits: UpcomingVisit[];
}
interface Executive {
  id: string; name: string; email: string;
}
interface Delegation {
  id: string;
  status: "PENDING" | "ACCEPTED" | "REJECTED";
  rejectionReason: string | null;
  toExecutive: { id: string; name: string };
  fromExecutive: { id: string; name: string };
  visit: { visitNumber: string; scheduledDate: string; client: { name: string } };
  leaveDate: string;
  leaveReason: string;
}
interface IncomingDelegation {
  id: string;
  fromExecutive: { id: string; name: string };
  visit: { id: string; visitNumber: string; scheduledDate: string; client: { name: string } };
  leaveDate: string;
  leaveReason: string;
}

// --- Helpers ----------------------------------------------------------------------
function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60); const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
  });
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata",
  });
}
function fmtDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", timeZone: "Asia/Kolkata",
  });
}

// --- Live Clock -----------------------------------------------------------------
function LiveClock({ punchIn }: { punchIn: string | null }) {
  const [now, setNow] = useState(new Date());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    timerRef.current = setInterval(() => setNow(new Date()), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);
  const timeStr = now.toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
  });
  const dateStr = now.toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata",
  });
  let duration = "";
  if (punchIn) {
    const elapsed = Math.floor((now.getTime() - new Date(punchIn).getTime()) / 60000);
    duration = fmtMinutes(elapsed);
  }
  return (
    <div className="text-center">
      <p className="text-3xl font-black text-white tracking-wider tabular-nums font-mono">{timeStr}</p>
      <p className="text-sm text-white/70 mt-1">{dateStr}</p>
      {duration && <p className="text-xs text-white/60 mt-0.5">Working: {duration}</p>}
    </div>
  );
}

// --- Status badge -----------------------------------------------------------------
function LeaveStatusBadge({ status }: { status: LeaveRequest["status"] }) {
  const map = {
    PENDING:  { label: "Pending",  cls: "bg-amber-100 text-amber-700 border-amber-200" },
    APPROVED: { label: "Approved", cls: "bg-green-100 text-green-700 border-green-200" },
    REJECTED: { label: "Rejected", cls: "bg-red-100  text-red-700   border-red-200"   },
  };
  const m = map[status];
  return <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border", m.cls)}>{m.label}</span>;
}

// --- Incoming Delegation Card -----------------------------------------------------
function IncomingDelegationCard({
  delegation,
  onRespond,
  responding,
}: {
  delegation: IncomingDelegation;
  onRespond: (id: string, visitId: string, action: "ACCEPT" | "REJECT", reason?: string) => void;
  responding: boolean;
}) {
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  return (
    <div className="bg-white border border-[#25488e]/30 rounded-xl overflow-hidden shadow-sm">
      <div className="px-4 py-3 bg-[#eef2f9] border-b border-[#adc2e2] flex items-center gap-2">
        <Bell className="w-3.5 h-3.5 text-[#25488e]" />
        <p className="text-xs font-bold text-[#25488e]">Coverage Request from {delegation.fromExecutive.name}</p>
      </div>
      <div className="p-4 space-y-3">
        <div className="bg-[#f8f9fc] rounded-lg p-3">
          <p className="text-xs font-semibold text-[#0f1829]">
            {delegation.visit.client.name} · {delegation.visit.visitNumber}
          </p>
          <p className="text-xs text-[#8896a9] mt-0.5">
            {fmtDate(delegation.visit.scheduledDate)} · {fmtTime(delegation.visit.scheduledDate)}
          </p>
          <p className="text-[11px] text-[#8896a9] mt-1">
            <span className="font-medium text-[#0f1829]">Leave reason:</span> {delegation.leaveReason}
          </p>
        </div>
        <p className="text-xs text-[#4a5568]">
          {delegation.fromExecutive.name} is requesting leave on{" "}
          <span className="font-semibold">{fmtDateShort(delegation.leaveDate)}</span> and needs you to cover this visit.
          If you accept, the visit will be transferred to you.
        </p>

        {!showRejectInput ? (
          <div className="flex gap-2">
            <button
              onClick={() => onRespond(delegation.id, delegation.visit.id, "ACCEPT")}
              disabled={responding}
              className="flex-1 bg-[#25488e] hover:bg-[#1e3a72] text-white text-sm font-bold py-2.5 rounded-xl transition-colors press-effect disabled:opacity-50"
            >
              {responding ? "…" : "Accept"}
            </button>
            <button
              onClick={() => setShowRejectInput(true)}
              disabled={responding}
              className="flex-1 bg-white border border-[#e2e7f0] hover:border-red-300 hover:bg-red-50 text-[#dc2626] text-sm font-bold py-2.5 rounded-xl transition-colors press-effect disabled:opacity-50"
            >
              Decline
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for declining (optional)…"
              rows={2}
              className="w-full border border-[#e2e7f0] rounded-lg px-3 py-2 text-sm text-[#0f1829] bg-white focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={() => onRespond(delegation.id, delegation.visit.id, "REJECT", rejectReason)}
                disabled={responding}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm font-bold py-2 rounded-xl transition-colors press-effect disabled:opacity-50"
              >
                {responding ? "…" : "Confirm Decline"}
              </button>
              <button
                onClick={() => { setShowRejectInput(false); setRejectReason(""); }}
                className="px-3 py-2 rounded-xl border border-[#e2e7f0] text-[#8896a9] hover:bg-[#f1f4f9] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Visit Conflict Panel -----------------------------------------------------
// Shown inline on the leave form when a conflict visit is detected
function VisitConflictPanel({
  conflict,
  leaveDate,
  leaveReason,
  executives,
  existingDelegation,
  onDelegateSubmit,
  onDelegateSuccess,
  onRescheduled,
  minDate,
  submitting,
}: {
  conflict: UpcomingVisit;
  leaveDate: string;
  leaveReason: string;
  executives: Executive[];
  existingDelegation: Delegation | null;
  onDelegateSubmit: (visitId: string, toExecId: string) => void;
  onDelegateSuccess: () => void;
  onRescheduled: () => void;
  minDate: string;
  submitting: boolean;
}) {
  const [selectedExecId, setSelectedExecId] = useState("");
  const [mode, setMode] = useState<"choose" | "delegate" | "reschedule">("choose");
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduling, setRescheduling] = useState(false);
  const [rescheduleError, setRescheduleError] = useState("");

  const handleRescheduleSave = async () => {
    if (!rescheduleDate) { toast.error("Please select a new date"); return; }
    setRescheduling(true);
    setRescheduleError("");
    try {
      const res = await fetch(`/api/visits/${conflict.id}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: rescheduleDate, reason: "Rescheduled to accommodate leave request" }),
      });
      const data = await res.json() as { error?: string; code?: string };
      if (!res.ok) {
        if (data.code === "LEAVE_CONFLICT") { setRescheduleError(data.error ?? "Leave conflict"); return; }
        toast.error(data.error ?? "Failed to reschedule");
        return;
      }
      toast.success("Visit rescheduled!");
      onRescheduled();
    } finally {
      setRescheduling(false);
    }
  };

  // If a delegation was already sent, show its status
  if (existingDelegation) {
    if (existingDelegation.status === "PENDING") {
      return (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <p className="text-sm font-bold text-amber-800">Delegation request sent</p>
          </div>
          <p className="text-xs text-amber-700">
            Waiting for <span className="font-semibold">{existingDelegation.toExecutive.name}</span> to respond.
            You will be notified here when they accept or decline.
          </p>
          <p className="text-[11px] text-amber-600">
            Visit: {conflict.client.name} · {fmtDate(conflict.scheduledDate)}
          </p>
        </div>
      );
    }

    if (existingDelegation.status === "REJECTED") {
      return (
        <div className="space-y-3">
          {/* Rejection notice */}
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-red-800">Delegation declined</p>
                <p className="text-xs text-red-700 mt-0.5">
                  <span className="font-semibold">{existingDelegation.toExecutive.name}</span> declined to cover.
                  {existingDelegation.rejectionReason && (
                    <> Reason: "{existingDelegation.rejectionReason}"</>
                  )}
                </p>
              </div>
            </div>
          </div>
          {/* Allow retry */}
          <p className="text-xs text-[#4a5568] font-medium">What would you like to do?</p>
          <div className="flex gap-2">
            <button
              onClick={() => setMode("delegate")}
              className="flex-1 flex items-center justify-center gap-1.5 text-sm font-bold py-2.5 rounded-xl border border-[#25488e] text-[#25488e] hover:bg-[#eef2f9] transition-colors press-effect"
            >
              <Users className="w-3.5 h-3.5" /> Choose another
            </button>
            <button
              onClick={() => setMode("reschedule")}
              className="flex-1 flex items-center justify-center gap-1.5 text-sm font-bold py-2.5 rounded-xl border border-[#800040] text-[#800040] hover:bg-[#fff0f6] transition-colors press-effect"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reschedule
            </button>
          </div>
          {mode === "delegate" && (
            <div className="space-y-2 pt-1">
              <select
                value={selectedExecId}
                onChange={(e) => setSelectedExecId(e.target.value)}
                className="w-full border border-[#e2e7f0] rounded-lg px-3 py-2.5 text-sm text-[#0f1829] bg-white focus:outline-none focus:ring-2 focus:ring-[#25488e]/30"
              >
                <option value="">Select executive…</option>
                {executives
                  .filter((e) => e.id !== existingDelegation.toExecutive.id)
                  .map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <button
                onClick={() => { if (selectedExecId) onDelegateSubmit(conflict.id, selectedExecId); }}
                disabled={!selectedExecId || submitting}
                className="w-full bg-[#25488e] hover:bg-[#1e3a72] text-white text-sm font-bold py-2.5 rounded-xl transition-colors press-effect disabled:opacity-50"
              >
                {submitting ? "Sending…" : "Delegate & submit"}
              </button>
            </div>
          )}
        </div>
      );
    }
  }

  // No delegation yet — show the conflict UI
  const fmtConflictTime = fmtTime(conflict.scheduledDate);

  return (
    <div className="space-y-3">
      {/* Blocked header */}
      <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
        <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-bold text-red-800">Leave is blocked</p>
          <p className="text-xs text-red-700 mt-0.5">
            {conflict.client.name} · {fmtConflictTime} is pre-set. Delegate or reschedule
            it first — then the request goes to Admin.
          </p>
        </div>
      </div>

      {mode === "choose" && (
        <div className="flex gap-2">
          <button
            onClick={() => setMode("reschedule")}
            className="flex-1 flex items-center justify-center gap-1.5 text-sm font-bold py-2.5 rounded-xl border-2 border-[#0f1829] text-[#0f1829] hover:bg-[#f8f9fc] transition-colors press-effect"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reschedule instead
          </button>
          <button
            onClick={() => setMode("delegate")}
            className="flex-1 flex items-center justify-center gap-1.5 text-sm font-bold py-2.5 rounded-xl bg-[#25488e] hover:bg-[#1e3a72] text-white transition-colors press-effect"
          >
            <Users className="w-3.5 h-3.5" /> Delegate & submit
          </button>
        </div>
      )}

      {mode === "delegate" && (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-[#4a5568] mb-1 block">
              Delegate this visit to
            </label>
            <select
              value={selectedExecId}
              onChange={(e) => setSelectedExecId(e.target.value)}
              className="w-full border border-[#e2e7f0] rounded-lg px-3 py-2.5 text-sm text-[#0f1829] bg-white focus:outline-none focus:ring-2 focus:ring-[#25488e]/30"
            >
              <option value="">Select executive…</option>
              {executives.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setMode("reschedule")}
              className="flex-1 flex items-center justify-center gap-1.5 text-sm font-bold py-2.5 rounded-xl border-2 border-[#0f1829] text-[#0f1829] hover:bg-[#f8f9fc] transition-colors press-effect"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reschedule instead
            </button>
            <button
              onClick={() => { if (selectedExecId) onDelegateSubmit(conflict.id, selectedExecId); }}
              disabled={!selectedExecId || submitting || !leaveReason.trim()}
              className="flex-1 flex items-center justify-center gap-1.5 text-sm font-bold py-2.5 rounded-xl bg-[#25488e] hover:bg-[#1e3a72] text-white transition-colors press-effect disabled:opacity-50"
            >
              {submitting ? "…" : <><ArrowRight className="w-3.5 h-3.5" /> Delegate & submit</>}
            </button>
          </div>
          <button
            onClick={() => setMode("choose")}
            className="w-full text-xs text-[#8896a9] hover:text-[#4a5568] transition-colors"
          >
            ← Back
          </button>
        </div>
      )}

      {mode === "reschedule" && (
        <div className="space-y-3">
          <p className="text-xs text-[#4a5568]">
            Pick a new date for this visit. Once saved, your leave request will be submitted automatically.
          </p>
          {rescheduleError && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
              <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">{rescheduleError}</p>
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-[#4a5568] mb-1 block">New visit date</label>
            <input
              type="date"
              min={minDate}
              value={rescheduleDate}
              onChange={(e) => { setRescheduleDate(e.target.value); setRescheduleError(""); }}
              className="w-full border border-[#e2e7f0] rounded-lg px-3 py-2.5 text-sm text-[#0f1829] bg-white focus:outline-none focus:ring-2 focus:ring-[#25488e]/30 focus:border-[#25488e]"
            />
          </div>
          <button
            onClick={handleRescheduleSave}
            disabled={rescheduling || !rescheduleDate}
            className="w-full flex items-center justify-center gap-1.5 bg-[#800040] hover:bg-[#6b0034] text-white text-sm font-bold py-2.5 rounded-xl transition-colors press-effect disabled:opacity-50"
          >
            {rescheduling ? "Saving…" : "Save new date"}
          </button>
          <button
            onClick={() => setMode("choose")}
            className="w-full text-xs text-[#8896a9] hover:text-[#4a5568] transition-colors"
          >
            ← Back
          </button>
        </div>
      )}
    </div>
  );
}

// --- Page -----------------------------------------------------------------------
export default function LeavePage() {
  const [actionLoading, setActionLoading] = useState(false);

  // Leave form state
  const [selectedDate, setSelectedDate] = useState("");
  const [leaveReason,  setLeaveReason]  = useState("");
  const [visitConflict, setVisitConflict] = useState<UpcomingVisit[]>([]);

  // Delegation state
  const [executives, setExecutives]                 = useState<Executive[]>([]);
  const [existingDelegations, setExistingDelegations] = useState<Record<string, Delegation>>({});
  const [delegationSubmitting, setDelegationSubmitting] = useState(false);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  const fetchAllData = useCallback(async () => {
    const [attData, leaveData, incomingData] = await Promise.all([
      fetchJSON<AttendanceData>("/api/attendance"),
      fetchJSON<LeavesData>("/api/leaves"),
      fetchJSON<{ incoming: IncomingDelegation[] }>("/api/delegations/incoming"),
    ]);
    return {
      attendance: attData,
      leavesData: leaveData,
      incomingDelegations: incomingData.incoming ?? [],
    };
  }, []);

  const { data: allData, loading, refresh: fetchAll } = useLiveQuery(fetchAllData);
  const attendance = allData?.attendance ?? null;
  const leavesData = allData?.leavesData ?? null;
  const incomingDelegations = allData?.incomingDelegations ?? [];

  // `leavesData` is a brand-new object every poll cycle (useLiveQuery refetches
  // in the background even when nothing actually changed), so depending on it
  // directly would re-run the conflict/delegate-status lookups below on every
  // single poll. Depend on a content-derived key instead — this effect now
  // only re-runs when the selected date changes or the actual set of upcoming
  // visits changes, not on every background refresh.
  const upcomingVisitsKey = useMemo(
    () => (leavesData?.upcomingVisits ?? []).map((v) => `${v.id}:${v.scheduledDate}`).join("|"),
    [leavesData]
  );

  // When a conflict visit is found, fetch available executives + any existing delegation
  useEffect(() => {
    if (!selectedDate || !leavesData) { setVisitConflict([]); return; }
    const sel = new Date(selectedDate).toDateString();
    const conflicts = leavesData.upcomingVisits.filter(
      (v) => new Date(v.scheduledDate).toDateString() === sel
    );
    setVisitConflict(conflicts);

    // For each conflict, check existing delegation state
    conflicts.forEach(async (v) => {
      try {
        const res = await fetch(`/api/visits/${v.id}/delegate`);
        const data = await res.json() as {
          executives: Executive[];
          existingDelegation: Delegation | null;
        };
        setExecutives(data.executives ?? []);
        if (data.existingDelegation) {
          setExistingDelegations((prev) => ({ ...prev, [v.id]: data.existingDelegation! }));
        }
      } catch { /* silent */ }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, upcomingVisitsKey]);

  const minDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  })();

  // --- Attendance ---------------------------------------------------------------
  const handlePunchIn = async () => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/attendance", { method: "POST" });
      if (!res.ok) { const j = await res.json() as { error: string }; toast.error(j.error); return; }
      toast.success("Punched in successfully!");
      await fetchAll();
    } finally { setActionLoading(false); }
  };
  const handlePunchOut = async () => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/attendance/punch-out", { method: "POST" });
      if (!res.ok) { const j = await res.json() as { error: string }; toast.error(j.error); return; }
      toast.success("Punched out successfully!");
      await fetchAll();
    } finally { setActionLoading(false); }
  };

  // --- Leave submit (no conflict) -------------------------------------------
  const handleSubmitLeave = async (skipConflictCheck = false) => {
    if (!selectedDate || !leaveReason.trim()) {
      toast.error("Please select a date and enter a reason"); return;
    }
    if (!skipConflictCheck && visitConflict.length > 0) {
      toast.error("Please delegate or reschedule your visit first"); return;
    }
    setActionLoading(true);
    try {
      const res = await fetch("/api/leaves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: selectedDate, reason: leaveReason.trim() }),
      });
      const j = await res.json() as { error?: string };
      if (!res.ok) { toast.error(j.error ?? "Failed to submit leave"); return; }
      toast.success("Leave request submitted!");
      setSelectedDate(""); setLeaveReason("");
      await fetchAll();
    } finally { setActionLoading(false); }
  };

  // --- Visit rescheduled inline from the leave conflict panel --------------
  // Refresh so the resolved conflict disappears, then submit the leave
  // request automatically (the conflict that blocked it is now gone).
  const handleVisitRescheduled = async () => {
    await fetchAll();
    await handleSubmitLeave(true);
  };

  // --- Delegate visit -------------------------------------------------------------
  const handleDelegateSubmit = async (visitId: string, toExecId: string) => {
    if (!leaveReason.trim()) {
      toast.error("Please enter a leave reason first"); return;
    }
    setDelegationSubmitting(true);
    try {
      const res = await fetch(`/api/visits/${visitId}/delegate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toExecutiveId: toExecId,
          leaveDate: selectedDate,
          leaveReason: leaveReason.trim(),
        }),
      });
      const data = await res.json() as { delegation?: Delegation; error?: string };
      if (!res.ok) { toast.error(data.error ?? "Failed to send delegation request"); return; }
      toast.success(`Delegation request sent to ${data.delegation?.toExecutive.name}!`);
      if (data.delegation) {
        setExistingDelegations((prev) => ({ ...prev, [visitId]: data.delegation! }));
      }
    } finally { setDelegationSubmitting(false); }
  };

  // --- Respond to incoming delegation (as target exec) -----------------------
  const handleRespondDelegation = async (
    delegationId: string,
    visitId: string,
    action: "ACCEPT" | "REJECT",
    reason?: string
  ) => {
    setRespondingId(delegationId);
    try {
      const res = await fetch(`/api/visits/${visitId}/delegation`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delegationId, action, rejectionReason: reason }),
      });
      const data = await res.json() as { message?: string; error?: string };
      if (!res.ok) { toast.error(data.error ?? "Failed"); return; }
      toast.success(action === "ACCEPT" ? "Visit accepted! Visit is now yours." : "Declined.");
      await fetchAll();
    } finally { setRespondingId(null); }
  };

  const today        = attendance?.today ?? null;
  const hasPunchedIn  = !!today?.punchIn;
  const hasPunchedOut = !!today?.punchOut;

  return (
    <div className="animate-in space-y-5">

      {/* --- Incoming delegation requests (if any) ------------------------------ */}
      {!loading && incomingDelegations.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-[#25488e]" />
            <h2 className="text-sm font-bold text-[#0f1829]">
              Coverage Requests ({incomingDelegations.length})
            </h2>
          </div>
          {incomingDelegations.map((d) => (
            <IncomingDelegationCard
              key={d.id}
              delegation={d}
              onRespond={handleRespondDelegation}
              responding={respondingId === d.id}
            />
          ))}
        </div>
      )}

      {/* --- Attendance Card ----------------------------------------------------- */}
      <div className="rounded-2xl bg-[#172d58] overflow-hidden shadow-lg">
        <div className="px-5 pt-6 pb-4">
          <LiveClock punchIn={hasPunchedIn && !hasPunchedOut ? today!.punchIn : null} />
        </div>
        <div className="text-center pb-2">
          {loading ? (
            <p className="text-sm text-white/50">Loading…</p>
          ) : hasPunchedOut ? (
            <p className="text-sm text-green-300 font-medium">
              Completed · {fmtMinutes(today!.workingMinutes ?? 0)} worked
            </p>
          ) : hasPunchedIn ? (
            <p className="text-sm text-white/70">
              Punched in at {fmtTime(today!.punchIn)}
              {today!.isLate
                ? <span className="ml-2 text-amber-300 font-semibold">· Late</span>
                : <span className="ml-2 text-emerald-300 font-semibold">· On Time</span>}
            </p>
          ) : (
            <p className="text-sm text-white/60">Not punched in · {fmtDate(new Date().toISOString())}</p>
          )}
        </div>
        <div className="flex justify-center pb-5">
          {!loading && !hasPunchedOut && (
            <button
              onClick={hasPunchedIn ? handlePunchOut : handlePunchIn}
              disabled={actionLoading}
              className={cn(
                "px-8 py-3 rounded-xl font-bold text-sm transition-all press-effect shadow-md",
                hasPunchedIn ? "bg-[#ff944d] text-white hover:bg-orange-500" : "bg-white text-[#172d58] hover:bg-[#f1f4f9]",
                actionLoading && "opacity-60 cursor-not-allowed"
              )}
            >
              {actionLoading ? "…" : hasPunchedIn ? (
                <span className="flex items-center gap-2"><LogOut className="w-4 h-4" /> Punch Out</span>
              ) : (
                <span className="flex items-center gap-2"><LogIn className="w-4 h-4" /> Punch In</span>
              )}
            </button>
          )}
          {!loading && hasPunchedOut && (
            <div className="flex items-center gap-2 text-green-300 text-sm font-semibold">
              <CheckCircle2 className="w-4 h-4" /> Day complete
            </div>
          )}
        </div>
        {(attendance?.streak ?? 0) > 0 && (
          <div className="flex justify-center pb-4">
            <span className="flex items-center gap-1.5 text-xs text-white/70 bg-white/10 px-3 py-1 rounded-full">
              <Flame className="w-3.5 h-3.5 text-orange-300" />
              {attendance!.streak}-day punch streak
            </span>
          </div>
        )}
      </div>

      {/* --- Attendance History ---------------------------------------------------- */}
      {!loading && (attendance?.history?.length ?? 0) > 0 && (
        <div className="bg-white border border-[#e2e7f0] rounded-xl overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-[#f1f4f9] flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#25488e]" />
            <h2 className="text-sm font-bold text-[#0f1829]">Recent Attendance</h2>
          </div>
          <div className="divide-y divide-[#f1f4f9]">
            {attendance!.history.slice(0, 7).map((rec) => (
              <div key={rec.id} className="flex items-center justify-between px-4 py-3 gap-3">
                <div>
                  <p className="text-xs font-semibold text-[#0f1829]">{fmtDate(rec.date)}</p>
                  <p className="text-[11px] text-[#8896a9] mt-0.5">
                    In: {fmtTime(rec.punchIn)}
                    {rec.punchOut && ` · Out: ${fmtTime(rec.punchOut)}`}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  {rec.workingMinutes != null && (
                    <p className="text-xs font-bold text-[#0f1829]">{fmtMinutes(rec.workingMinutes)}</p>
                  )}
                  {rec.isLate && <p className="text-[10px] text-amber-600 font-medium">Late</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* --- Raise Leave ----------------------------------------------------------- */}
      <div className="bg-white border border-[#e2e7f0] rounded-xl overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-[#f1f4f9] flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-[#800040]" />
          <h2 className="text-sm font-bold text-[#0f1829]">Raise Leave</h2>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-[#8896a9]">
            Pick a date — if a visit is planned, you must hand it over first.
          </p>
          <div>
            <label className="text-xs font-semibold text-[#4a5568] mb-1 block">Leave Date</label>
            <input
              type="date"
              min={minDate}
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full border border-[#e2e7f0] rounded-lg px-3 py-2.5 text-sm text-[#0f1829] bg-white focus:outline-none focus:ring-2 focus:ring-[#25488e]/30 focus:border-[#25488e]"
            />
          </div>

          {/* Show conflict panel inline when visits conflict */}
          {visitConflict.length > 0 ? (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-[#4a5568] mb-1 block">Reason for leave</label>
                <textarea
                  value={leaveReason}
                  onChange={(e) => setLeaveReason(e.target.value)}
                  placeholder="Briefly explain the reason…"
                  rows={2}
                  className="w-full border border-[#e2e7f0] rounded-lg px-3 py-2.5 text-sm text-[#0f1829] bg-white focus:outline-none focus:ring-2 focus:ring-[#25488e]/30 resize-none"
                />
              </div>
              {visitConflict.map((conflict) => (
                <div key={conflict.id} className="space-y-2">
                  <p className="text-xs font-bold text-[#0f1829]">
                    Visit planned on {fmtDateShort(conflict.scheduledDate)}
                  </p>
                  <VisitConflictPanel
                    conflict={conflict}
                    leaveDate={selectedDate}
                    leaveReason={leaveReason}
                    executives={executives}
                    existingDelegation={existingDelegations[conflict.id] ?? null}
                    onDelegateSubmit={handleDelegateSubmit}
                    onDelegateSuccess={fetchAll}
                    onRescheduled={handleVisitRescheduled}
                    minDate={minDate}
                    submitting={delegationSubmitting}
                  />
                </div>
              ))}
            </div>
          ) : (
            <>
              <div>
                <label className="text-xs font-semibold text-[#4a5568] mb-1 block">Reason</label>
                <textarea
                  value={leaveReason}
                  onChange={(e) => setLeaveReason(e.target.value)}
                  placeholder="Briefly explain the reason for leave…"
                  rows={3}
                  className="w-full border border-[#e2e7f0] rounded-lg px-3 py-2.5 text-sm text-[#0f1829] bg-white focus:outline-none focus:ring-2 focus:ring-[#25488e]/30 resize-none"
                />
              </div>
              <button
                onClick={() => handleSubmitLeave()}
                disabled={actionLoading || !selectedDate || !leaveReason.trim()}
                className="w-full bg-[#800040] hover:bg-[#6b0034] text-white font-bold py-3 rounded-xl transition-colors press-effect disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {actionLoading ? "Submitting…" : "Submit Leave Request"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* --- My Leave History ------------------------------------------------------ */}
      {!loading && (leavesData?.leaves?.length ?? 0) > 0 && (
        <div className="bg-white border border-[#e2e7f0] rounded-xl overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-[#f1f4f9]">
            <h2 className="text-sm font-bold text-[#0f1829]">My Leave Requests</h2>
          </div>
          <div className="divide-y divide-[#f1f4f9]">
            {leavesData!.leaves.map((leave) => (
              <div key={leave.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-sm font-semibold text-[#0f1829]">{fmtDateShort(leave.date)}</p>
                  <LeaveStatusBadge status={leave.status} />
                </div>
                <p className="text-xs text-[#8896a9] truncate">{leave.reason}</p>
                {leave.adminComment && (
                  <p className="text-xs text-[#4a5568] mt-1 italic">Admin: {leave.adminComment}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* -- Footer link -- */}
      <a href="/executive/visits" className="flex items-center justify-center gap-1.5 text-xs font-semibold text-[#25488e] pb-2">
        View My Visits <ChevronRight className="w-3.5 h-3.5" />
      </a>
    </div>
  );
}
