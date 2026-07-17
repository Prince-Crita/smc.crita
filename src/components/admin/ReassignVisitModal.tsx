"use client";

import { useState, useCallback, useEffect } from "react";
import { Modal } from "@/components/ui/Modal";
import { ArrowRight, AlertCircle } from "lucide-react";
import toast from "react-hot-toast";

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

  const availableExecs = executives.filter((e) => e.id !== visit?.executiveId);

  useEffect(() => {
    if (visit) {
      setVisitDate(toDateInputValue(visit.scheduledDate));
      setVisitTime(toTimeInputValue(visit.scheduledDate));
      setLeaveWarning("");
    }
  }, [visit]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!visit) return;
      if (!toExecutiveId) { toast.error("Please select an executive"); return; }
      if (reason.trim().length < 5) { toast.error("Please provide a reason (min 5 characters)"); return; }
      if (!visitDate || !visitTime) { toast.error("Please select a visit date and time"); return; }

      setLoading(true);
      setLeaveWarning("");
      try {
        const scheduledDate = `${visitDate}T${visitTime}:00.000Z`;
        const res  = await fetch(`/api/admin/visits/${visit.id}/reassign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toExecutiveId, reason: reason.trim(), scheduledDate }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (data.code === "LEAVE_CONFLICT") { setLeaveWarning(data.error || "Leave conflict"); return; }
          toast.error(data.error || "Reassignment failed");
          return;
        }

        toast.success("Visit reassigned successfully");
        onSuccess();
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
    <Modal isOpen={!!visit} onClose={onClose} title="Reassign Visit" size="sm">
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

              {/* Executive select */}
              <div>
                <label className="block text-sm font-semibold text-[#0f1829] mb-1.5">
                  Assign To <span className="text-red-500">*</span>
                </label>
                <select
                  className={inputClass}
                  value={toExecutiveId}
                  onChange={(e) => { setToExecutiveId(e.target.value); setLeaveWarning(""); }}
                >
                  <option value="">— Select Executive —</option>
                  {availableExecs.map((ex) => (
                    <option key={ex.id} value={ex.id}>{ex.name}</option>
                  ))}
                </select>
              </div>

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
            {loading ? "Reassigning…" : "Confirm Reassign"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
