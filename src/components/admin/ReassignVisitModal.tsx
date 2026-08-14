"use client";

import { useState, useCallback, useEffect } from "react";
import { Modal } from "@/components/ui/Modal";
import { ArrowRight, AlertCircle } from "lucide-react";
import toast from "react-hot-toast";
import { revalidateAll } from "@/lib/hooks/useLiveQuery";

interface Visit {
  id: string;
  visitNumber: string;
  executiveId: string;
  executive: { name: string };
  scheduledDate: string;
}

interface ReassignVisitModalProps {
  visit: Visit | null;
  executives: { id: string; name: string }[];
  onClose: () => void;
  onSuccess: () => void;
}

const inputClass =
  "bg-[#f8f9fc] border border-[#e2e7f0] rounded-lg px-3.5 py-2.5 text-[#0f1829] placeholder-[#8896a9] focus:outline-none focus:border-[#25488e] focus:ring-2 focus:ring-[#25488e]/15 text-sm w-full transition-all";

// ─── Date/time helpers ─────────────────────────────────────────────────────
// scheduledDate is stored/displayed using its raw UTC components (same
// convention used elsewhere in this app, e.g. admin calendar's dayISO()).
function toDateInputValue(iso: string): string {
  return iso.slice(0, 10);
}
function toTimeInputValue(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function ReassignVisitModal({ visit, executives, onClose, onSuccess }: ReassignVisitModalProps) {
  const [toExecutiveId, setToExecutiveId] = useState("");
  const [reason, setReason]               = useState("");
  const [visitDate, setVisitDate]         = useState("");
  const [visitTime, setVisitTime]         = useState("");
  const [loading, setLoading]             = useState(false);
  const [leaveWarning, setLeaveWarning]   = useState("");
  // Solo/Team assignment for THIS existing visit. Switching either way edits
  // the same visit — no duplicate visit, no loss of task/subtask progress.
  const [visitType, setVisitType]         = useState<"SOLO" | "TEAM">("SOLO");
  const [memberIds, setMemberIds]         = useState<string[]>([]);

  // For SOLO the current owner is excluded (you reassign to someone else);
  // for TEAM every executive can be the lead, including the current one.
  const availableExecs = visitType === "TEAM"
    ? executives
    : executives.filter((e) => e.id !== visit?.executiveId);

  useEffect(() => {
    if (!visit) return;
    setVisitDate(toDateInputValue(visit.scheduledDate));
    setVisitTime(toTimeInputValue(visit.scheduledDate));
    setLeaveWarning("");
    // Prefill from the visit's current assignment.
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/visits/${visit.id}/assignment`);
        if (!res.ok) return;
        const j = await res.json() as { assignment?: { visitType: "SOLO" | "TEAM"; teamLead: { id: string }; teamMembers: { id: string }[] } };
        if (cancelled || !j.assignment) return;
        setVisitType(j.assignment.visitType);
        setMemberIds(j.assignment.teamMembers.map((m) => m.id));
        if (j.assignment.visitType === "TEAM") setToExecutiveId(j.assignment.teamLead.id);
      } catch { /* prefill is best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [visit]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!visit) return;
      if (!toExecutiveId) { toast.error(visitType === "TEAM" ? "Please select a Team Lead" : "Please select an executive"); return; }
      if (visitType === "TEAM" && memberIds.length === 0) { toast.error("Add at least one team member, or switch to Solo"); return; }
      if (reason.trim().length < 5) { toast.error("Please provide a reason (min 5 characters)"); return; }
      if (!visitDate || !visitTime) { toast.error("Please select a visit date and time"); return; }

      setLoading(true);
      setLeaveWarning("");
      try {
        const scheduledDate = `${visitDate}T${visitTime}:00.000Z`;
        // The assignment endpoint edits THIS visit in place — solo↔team, lead
        // change, member add/remove and the date, all without creating a
        // duplicate visit or touching its tasks/subtasks.
        const res = await fetch(`/api/admin/visits/${visit.id}/assignment`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            visitType,
            executiveId: toExecutiveId,
            ...(visitType === "TEAM" ? { memberIds } : {}),
            reason: reason.trim(),
            scheduledDate,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (data.code === "LEAVE_CONFLICT") { setLeaveWarning(data.error || "Leave conflict"); return; }
          toast.error(data.error || "Assignment update failed");
          return;
        }

        toast.success(visitType === "TEAM" ? "Team assignment updated" : "Visit reassigned successfully");
        onSuccess();
        // Admin lists, calendar and the executive's own screens refetch once.
        revalidateAll();
        onClose();
      } catch {
        toast.error("An error occurred");
      } finally {
        setLoading(false);
      }
    },
    [visit, toExecutiveId, reason, visitDate, visitTime, onSuccess, onClose]
  );

  return (
    <Modal isOpen={!!visit} onClose={onClose} title="Visit Assignment" size="sm">
      <form onSubmit={handleSubmit}>
        <div className="p-5 space-y-4">
          {visit && (
            <>
              {/* Visit badge */}
              <div className="p-3.5 rounded-xl bg-[#f8f9fc] border border-[#e2e7f0]">
                <p className="text-xs text-[#8896a9] font-medium uppercase tracking-wide">Visit</p>
                <p className="text-sm font-bold text-[#25488e] mt-0.5 font-mono">{visit.visitNumber}</p>
              </div>

              {/* From → To preview */}
              <div className="flex items-center gap-2">
                <div className="flex-1 p-3.5 rounded-xl bg-amber-50 border border-amber-200">
                  <p className="text-xs text-amber-600 font-semibold uppercase tracking-wide">From</p>
                  <p className="text-sm font-semibold text-amber-800 mt-0.5 truncate">{visit.executive.name}</p>
                </div>
                <div className="flex-shrink-0 p-1.5 bg-[#f1f4f9] rounded-full">
                  <ArrowRight className="w-4 h-4 text-[#8896a9]" />
                </div>
                <div className="flex-1 p-3.5 rounded-xl bg-blue-50 border border-blue-200">
                  <p className="text-xs text-blue-600 font-semibold uppercase tracking-wide">To</p>
                  <p className="text-sm font-semibold text-blue-800 mt-0.5 truncate">
                    {availableExecs.find((e) => e.id === toExecutiveId)?.name || "—"}
                  </p>
                </div>
              </div>

              {/* Visit Type — Solo or Team for this existing visit */}
              <div>
                <label className="block text-sm font-semibold text-[#0f1829] mb-1.5">
                  Visit Type <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  {(["SOLO", "TEAM"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => { setVisitType(t); setMemberIds([]); setLeaveWarning(""); }}
                      className={
                        "flex-1 py-2 rounded-lg text-sm font-semibold border transition-colors " +
                        (visitType === t
                          ? "bg-[#25488e] text-white border-[#25488e]"
                          : "bg-white text-[#4a5568] border-[#e2e7f0] hover:bg-[#f1f4f9]")
                      }
                    >
                      {t === "SOLO" ? "Solo Visit" : "Team Visit"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Executive / Team Lead select */}
              <div>
                <label className="block text-sm font-semibold text-[#0f1829] mb-1.5">
                  {visitType === "TEAM" ? "Team Lead" : "Assign To"} <span className="text-red-500">*</span>
                </label>
                <select
                  className={inputClass}
                  value={toExecutiveId}
                  onChange={(e) => {
                    setToExecutiveId(e.target.value);
                    setMemberIds((prev) => prev.filter((id) => id !== e.target.value));
                    setLeaveWarning("");
                  }}
                >
                  <option value="">— Select Executive —</option>
                  {availableExecs.map((ex) => (
                    <option key={ex.id} value={ex.id}>{ex.name}</option>
                  ))}
                </select>
              </div>

              {/* Team members — the lead is excluded so nobody can be picked twice */}
              {visitType === "TEAM" && (
                <div>
                  <label className="block text-sm font-semibold text-[#0f1829] mb-1.5">
                    Team Members <span className="text-red-500">*</span>
                  </label>
                  <div className="border border-[#e2e7f0] rounded-lg divide-y divide-[#f1f4f9] max-h-40 overflow-y-auto">
                    {executives.filter((e) => e.id !== toExecutiveId).map((e) => {
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
                  </div>
                  <p className="text-xs text-[#8896a9] mt-1.5">
                    {memberIds.length} selected. Only the Team Lead can close a team visit.
                  </p>
                </div>
              )}

              {leaveWarning && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                  <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800">{leaveWarning}</p>
                </div>
              )}

              {/* Visit date + time */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-semibold text-[#0f1829] mb-1.5">
                    Visit Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    className={inputClass}
                    value={visitDate}
                    onChange={(e) => { setVisitDate(e.target.value); setLeaveWarning(""); }}
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-semibold text-[#0f1829] mb-1.5">
                    Visit Time <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="time"
                    className={inputClass}
                    value={visitTime}
                    onChange={(e) => { setVisitTime(e.target.value); setLeaveWarning(""); }}
                  />
                </div>
              </div>

              {/* Reason */}
              <div>
                <label className="block text-sm font-semibold text-[#0f1829] mb-1.5">
                  Reason for Reassignment <span className="text-red-500">*</span>
                </label>
                <textarea
                  className={`${inputClass} resize-none`}
                  rows={3}
                  placeholder="e.g. Executive is on leave, urgent coverage needed…"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <p className="text-xs text-[#8896a9] mt-1.5">This reason will be stored in the audit log.</p>
              </div>
            </>
          )}
        </div>

        {/* Sticky footer */}
        <div className="sticky bottom-0 bg-white px-5 py-4 border-t border-[#e2e7f0] flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#4a5568] text-sm font-semibold transition-all press-effect border border-[#e2e7f0]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 py-2.5 rounded-lg bg-[#25488e] hover:bg-[#1e3a72] disabled:opacity-50 text-white text-sm font-semibold transition-all press-effect shadow-sm"
          >
            {loading ? "Saving…" : "Save Assignment"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
