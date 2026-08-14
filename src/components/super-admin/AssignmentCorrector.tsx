"use client";

/**
 * Super Admin → correct a visit's Solo/Team configuration (§2).
 *
 * Posts to /api/super-admin/assignment, which runs the SAME
 * normalizeAssignment / applyAssignment path the admin workflow uses — so the
 * Solo/Team rules, the "no executive twice" rule, the approved-leave check and
 * the reassignment history all still apply, and the visit row is updated
 * rather than recreated (no duplicate visit, no lost tasks).
 *
 * The correction is audited with the previous lead, type AND members, so
 * undoing it restores the team exactly.
 */
import { useEffect, useState } from "react";
import { Loader2, Users, Save } from "lucide-react";
import toast from "react-hot-toast";
import { revalidateAll } from "@/lib/hooks/useLiveQuery";
import { cn } from "@/lib/utils/utils";

interface Exec { id: string; name: string }

export function AssignmentCorrector({
  visitId, currentType, currentLeadId, currentMemberIds, onDone,
}: {
  visitId: string;
  currentType: "SOLO" | "TEAM";
  currentLeadId: string;
  currentMemberIds: string[];
  onDone: () => void;
}) {
  const [execs, setExecs] = useState<Exec[]>([]);
  const [visitType, setVisitType] = useState<"SOLO" | "TEAM">(currentType);
  const [leadId, setLeadId] = useState(currentLeadId);
  const [memberIds, setMemberIds] = useState<string[]>(currentMemberIds);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/admin/executives", { signal: controller.signal });
        if (!res.ok) return;
        const j = await res.json() as { executives?: Exec[] };
        if (!controller.signal.aborted) setExecs(j.executives ?? []);
      } catch { /* aborted */ }
    })();
    return () => controller.abort();
  }, []);

  const toggleMember = (id: string) =>
    setMemberIds((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));

  const save = async () => {
    if (visitType === "TEAM" && memberIds.filter((m) => m !== leadId).length === 0) {
      toast.error("A Team Visit needs at least one team member besides the Team Lead.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/super-admin/assignment", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visitId, visitType, executiveId: leadId,
          memberIds: memberIds.filter((m) => m !== leadId),
          reason: reason.trim() || undefined,
        }),
      });
      const j = await res.json().catch(() => null) as { error?: string } | null;
      if (!res.ok) { toast.error(j?.error ?? `Assignment correction failed (${res.status})`); return; }
      toast.success("Assignment corrected. This can be undone from the Control Panel.");
      setReason("");
      onDone();
      revalidateAll();
    } finally {
      setSaving(false);
    }
  };

  const changed =
    visitType !== currentType ||
    leadId !== currentLeadId ||
    JSON.stringify([...memberIds].sort()) !== JSON.stringify([...currentMemberIds].sort());

  return (
    <section>
      <h3 className="text-xs font-bold uppercase tracking-wide text-[#8896a9] mb-2 flex items-center gap-1.5">
        <Users className="w-3.5 h-3.5" /> Correct assignment
      </h3>
      <div className="border border-[#e2e7f0] rounded-xl p-3 space-y-3">
        {/* Solo / Team */}
        <div className="flex gap-2">
          {(["SOLO", "TEAM"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setVisitType(t)}
              aria-pressed={visitType === t}
              className={cn(
                "flex-1 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors press-effect",
                visitType === t
                  ? "bg-[#25488e] text-white border-[#25488e]"
                  : "bg-white text-[#4a5568] border-[#e2e7f0] hover:bg-[#f1f4f9]"
              )}
            >
              {t === "SOLO" ? "Solo" : "Team"}
            </button>
          ))}
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-[#4a5568] mb-1" htmlFor="sa-lead">
            {visitType === "TEAM" ? "Team Lead" : "Executive"}
          </label>
          <select
            id="sa-lead"
            value={leadId}
            onChange={(e) => setLeadId(e.target.value)}
            className="w-full border border-[#e2e7f0] rounded-lg px-3 py-2 text-sm bg-white text-[#0f1829] focus:outline-none focus:ring-2 focus:ring-[#25488e]/30"
          >
            {execs.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>

        {visitType === "TEAM" && (
          <div>
            <p className="text-[11px] font-semibold text-[#4a5568] mb-1">Team members</p>
            <div className="border border-[#e2e7f0] rounded-lg divide-y divide-[#f1f4f9] max-h-44 overflow-y-auto overscroll-contain">
              {execs.filter((e) => e.id !== leadId).map((e) => (
                <label key={e.id} className="flex items-center gap-2 px-3 py-2 text-sm text-[#0f1829] cursor-pointer hover:bg-[#f8fafc]">
                  <input
                    type="checkbox"
                    checked={memberIds.includes(e.id)}
                    onChange={() => toggleMember(e.id)}
                    className="w-4 h-4 accent-[#25488e] flex-shrink-0"
                  />
                  <span className="truncate">{e.name}</span>
                </label>
              ))}
            </div>
            <p className="text-[11px] text-[#8896a9] mt-1">
              The lead is never also a member. An executive on approved leave that day is refused.
            </p>
          </div>
        )}

        <div>
          <label className="block text-[11px] font-semibold text-[#4a5568] mb-1" htmlFor="sa-asg-reason">
            Reason (optional, recorded in the audit log)
          </label>
          <input
            id="sa-asg-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. admin assigned the wrong executive"
            className="w-full border border-[#e2e7f0] rounded-lg px-3 py-2 text-sm bg-white text-[#0f1829] focus:outline-none focus:ring-2 focus:ring-[#25488e]/30"
          />
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[11px] text-[#8896a9]">
            The visit is updated in place — no duplicate visit, no task or subtask history lost.
          </p>
          <button
            type="button"
            onClick={save}
            disabled={saving || !changed}
            className="px-4 py-2 rounded-lg bg-[#25488e] hover:bg-[#1e3a72] text-white text-sm font-semibold transition-colors press-effect disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? "Saving…" : "Correct assignment"}
          </button>
        </div>
      </div>
    </section>
  );
}
