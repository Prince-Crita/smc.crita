"use client";

import { useState, useCallback } from "react";
import { Modal } from "@/components/ui/Modal";
import { ArrowRight } from "lucide-react";
import toast from "react-hot-toast";

interface Visit {
  id: string;
  visitNumber: string;
  executiveId: string;
  executive: { name: string };
}

interface ReassignVisitModalProps {
  visit: Visit | null;
  executives: { id: string; name: string }[];
  onClose: () => void;
  onSuccess: () => void;
}

const inputClass =
  "bg-slate-800 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/70 focus:ring-2 focus:ring-blue-500/20 text-sm w-full transition-all";

export function ReassignVisitModal({ visit, executives, onClose, onSuccess }: ReassignVisitModalProps) {
  const [toExecutiveId, setToExecutiveId] = useState("");
  const [reason, setReason]               = useState("");
  const [loading, setLoading]             = useState(false);

  const availableExecs = executives.filter((e) => e.id !== visit?.executiveId);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!visit) return;
      if (!toExecutiveId) { toast.error("Please select an executive"); return; }
      if (reason.trim().length < 5) { toast.error("Please provide a reason (min 5 characters)"); return; }

      setLoading(true);
      try {
        const res  = await fetch(`/api/admin/visits/${visit.id}/reassign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toExecutiveId, reason: reason.trim() }),
        });
        const data = await res.json();
        if (!res.ok) { toast.error(data.error || "Reassignment failed"); return; }

        toast.success("Visit reassigned successfully");
        onSuccess();
        onClose();
      } catch {
        toast.error("An error occurred");
      } finally {
        setLoading(false);
      }
    },
    [visit, toExecutiveId, reason, onSuccess, onClose]
  );

  return (
    <Modal isOpen={!!visit} onClose={onClose} title="Reassign Visit" size="sm">
      <form onSubmit={handleSubmit}>
        <div className="p-5 space-y-4">
          {visit && (
            <>
              {/* Visit badge */}
              <div className="p-3 rounded-xl bg-slate-800/50 border border-slate-700/50">
                <p className="text-xs text-slate-500">Visit</p>
                <p className="text-sm font-semibold text-white mt-0.5">{visit.visitNumber}</p>
              </div>

              {/* From → To preview */}
              <div className="flex items-center gap-2">
                <div className="flex-1 p-3 rounded-xl bg-slate-800/50 border border-slate-700/50">
                  <p className="text-xs text-slate-500">From</p>
                  <p className="text-sm font-medium text-amber-400 mt-0.5 truncate">{visit.executive.name}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-600 flex-shrink-0" />
                <div className="flex-1 p-3 rounded-xl bg-slate-800/50 border border-slate-700/50">
                  <p className="text-xs text-slate-500">To</p>
                  <p className="text-sm font-medium text-blue-400 mt-0.5 truncate">
                    {availableExecs.find((e) => e.id === toExecutiveId)?.name || "—"}
                  </p>
                </div>
              </div>

              {/* Executive select */}
              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-semibold">Assign To *</label>
                <select
                  className={inputClass}
                  value={toExecutiveId}
                  onChange={(e) => setToExecutiveId(e.target.value)}
                >
                  <option value="">— Select Executive —</option>
                  {availableExecs.map((ex) => (
                    <option key={ex.id} value={ex.id}>{ex.name}</option>
                  ))}
                </select>
              </div>

              {/* Reason */}
              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-semibold">
                  Reason for Reassignment *
                </label>
                <textarea
                  className={`${inputClass} resize-none`}
                  rows={3}
                  placeholder="e.g. Executive is on leave, urgent coverage needed…"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <p className="text-xs text-slate-600 mt-1">Stored in the audit log</p>
              </div>
            </>
          )}
        </div>

        {/* Footer — sticky so it stays visible when fields overflow */}
        <div className="sticky bottom-0 bg-slate-900 px-5 py-4 border-t border-slate-800/80 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium transition-all press-effect"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold transition-all press-effect"
          >
            {loading ? "Reassigning…" : "Confirm Reassign"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
