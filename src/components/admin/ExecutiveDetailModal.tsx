"use client";
import { useState, useEffect, useCallback } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge, ProgressBadge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SkeletonCard, SkeletonTable } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Building2, Mail, Phone, Users, CheckCircle2, Clock, TrendingUp, RotateCcw, Activity, X } from "lucide-react";
import { formatDate, formatTimeAgo } from "@/lib/utils/utils";
import toast from "react-hot-toast";

interface Executive {
  id: string; name: string; email: string; phone?: string | null; isActive: boolean; createdAt: string;
  visits: { id: string; visitNumber: string; client: { name: string; code: string }; status: string; displayStatus?: "PENDING" | "IN_PROGRESS" | "CLOSED"; scheduledDate: string; closedAt?: string | null; progress: number }[];
  activityLogs: { id: string; action: string; metadata: Record<string, unknown>; createdAt: string }[];
  assignedClients: { id: string; name: string }[];
  stats: { totalVisits: number; pendingCount: number; inProgressCount: number; closedCount: number; carryForwardCount: number };
}

interface ExecutiveDetailModalProps {
  executiveId: string | null;
  onClose: () => void;
  /** Called after a visit is successfully removed, so the caller can refresh the executives list/dashboard. */
  onVisitRemoved?: () => void;
}

const ACTION_LABELS: Record<string, string> = {
  USER_LOGIN: "Logged in", USER_LOGOUT: "Logged out", VISIT_OPENED: "Opened visit", VISIT_CLOSED: "Closed visit",
  TASK_COMPLETED: "Completed task", SUBTASK_COMPLETED: "Completed subtask", CARRY_FORWARD_APPLIED: "Carry-forward applied",
};

export function ExecutiveDetailModal({ executiveId, onClose, onVisitRemoved }: ExecutiveDetailModalProps) {
  const [exec, setExec] = useState<Executive | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"visits" | "activity">("visits");
  const [removeTarget, setRemoveTarget] = useState<{ id: string; clientName: string; visitNumber: string } | null>(null);

  const fetchExec = useCallback(async () => {
    if (!executiveId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/executives/${executiveId}`);
      const data = await res.json();
      setExec(data.executive);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [executiveId]);

  useEffect(() => {
    if (executiveId) { setExec(null); setActiveTab("visits"); fetchExec(); }
  }, [executiveId, fetchExec]);

  const confirmRemoveVisit = async () => {
    if (!removeTarget) return;
    try {
      const res = await fetch(`/api/admin/visits/${removeTarget.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || "Failed to remove visit"); return; }
      toast.success("Visit removed");
      setRemoveTarget(null);
      await fetchExec();
      onVisitRemoved?.();
    } catch {
      toast.error("Error removing visit");
    }
  };

  return (
    <Modal isOpen={!!executiveId} onClose={onClose} title="Executive Profile" size="xl">
      <div className="p-5">
        {loading && (
          <div className="space-y-4">
            <SkeletonCard /><SkeletonCard /><SkeletonTable rows={4} />
          </div>
        )}

        {!loading && exec && (
          <div className="space-y-5">
            {/* Profile Header */}
            <div className="flex items-start gap-4 p-4 bg-[#f8f9fc] rounded-2xl border border-[#e2e7f0]">
              <div className="w-14 h-14 rounded-2xl bg-[#25488e] flex items-center justify-center text-white font-bold text-xl flex-shrink-0">
                {exec.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-lg font-bold text-[#0f1829]">{exec.name}</h3>
                  <Badge variant={exec.isActive ? "active" : "inactive"}>{exec.isActive ? "Active" : "Inactive"}</Badge>
                </div>
                <div className="mt-1 space-y-1">
                  <p className="text-sm text-[#4a5568] flex items-center gap-1.5"><Mail className="w-3.5 h-3.5 text-[#8896a9]" />{exec.email}</p>
                  {exec.phone && <p className="text-sm text-[#4a5568] flex items-center gap-1.5"><Phone className="w-3.5 h-3.5 text-[#8896a9]" />{exec.phone}</p>}
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { icon: Clock, label: "Pending", value: exec.stats.pendingCount, iconColor: "text-amber-500", countColor: "text-amber-600", bg: "bg-amber-50 border-amber-100" },
                { icon: TrendingUp, label: "In Progress", value: exec.stats.inProgressCount, iconColor: "text-[#25488e]", countColor: "text-[#25488e]", bg: "bg-[#eef2fb] border-[#d4ddf5]" },
                { icon: CheckCircle2, label: "Closed", value: exec.stats.closedCount, iconColor: "text-green-600", countColor: "text-green-600", bg: "bg-green-50 border-green-100" },
                { icon: RotateCcw, label: "Carry-Fwd", value: exec.stats.carryForwardCount, iconColor: "text-[#ff944d]", countColor: "text-[#ff944d]", bg: "bg-orange-50 border-orange-100" },
              ].map(({ icon: Icon, label, value, iconColor, countColor, bg }) => (
                <div key={label} className={`rounded-xl p-3 text-center border ${bg}`}>
                  <Icon className={`w-4 h-4 mx-auto mb-1 ${iconColor}`} />
                  <p className={`text-xl font-bold ${countColor}`}>{value}</p>
                  <p className="text-xs text-[#8896a9] mt-0.5">{label}</p>
                </div>
              ))}
            </div>

            {/* Assigned Clients */}
            {exec.assignedClients.length > 0 && (
              <div>
                <p className="text-xs text-[#8896a9] uppercase tracking-wider mb-2 flex items-center gap-1.5 font-semibold">
                  <Building2 className="w-3.5 h-3.5" />Assigned Clients
                </p>
                <div className="flex flex-wrap gap-2">
                  {exec.assignedClients.map((c) => (
                    <span key={c.id} className="px-2.5 py-1 rounded-full bg-[#f1f4f9] border border-[#e2e7f0] text-xs text-[#4a5568] font-medium">{c.name}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 p-1 bg-[#f8f9fc] rounded-xl border border-[#e2e7f0]">
              {(["visits", "activity"] as const).map((tab) => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-1.5 text-sm font-semibold rounded-lg transition-colors capitalize ${
                    activeTab === tab
                      ? "bg-white text-[#25488e] shadow-sm border border-[#e2e7f0]"
                      : "text-[#8896a9] hover:text-[#4a5568]"
                  }`}>
                  {tab === "visits" ? `Visits (${exec.stats.totalVisits})` : "Activity"}
                </button>
              ))}
            </div>

            {/* Visits Tab */}
            {activeTab === "visits" && (
              <div className="space-y-2">
                {exec.visits.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="w-10 h-10 rounded-xl bg-[#f1f4f9] flex items-center justify-center mx-auto mb-2">
                      <Users className="w-5 h-5 text-[#c8d2e0]" />
                    </div>
                    <p className="text-sm text-[#4a5568] font-medium">No visits assigned</p>
                  </div>
                ) : exec.visits.map((v) => (
                  <div key={v.id} className="flex items-center gap-3 p-3 rounded-xl bg-[#f8f9fc] border border-[#e2e7f0] hover:border-[#c8d2e0] transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-white border border-[#e2e7f0] flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-4 h-4 text-[#8896a9]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-[#0f1829]">{v.client.name}</span>
                        <span className="text-xs text-[#8896a9] font-mono">{v.visitNumber}</span>
                        <ProgressBadge progress={v.progress} displayStatus={v.displayStatus} />
                      </div>
                      <div className="mt-1.5"><ProgressBar value={v.progress} size="sm" /></div>
                      <p className="text-xs text-[#8896a9] mt-1">{formatDate(new Date(v.scheduledDate))}{v.closedAt && ` · Closed ${formatDate(new Date(v.closedAt))}`}</p>
                    </div>
                    {v.status !== "CLOSED" && (
                      <button
                        onClick={() => setRemoveTarget({ id: v.id, clientName: v.client.name, visitNumber: v.visitNumber })}
                        className="p-2 rounded-lg bg-white border border-[#e2e7f0] text-[#8896a9] hover:text-red-600 hover:bg-red-50 hover:border-red-200 transition-all press-effect flex-shrink-0"
                        title="Remove Visit"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Activity Tab */}
            {activeTab === "activity" && (
              <div className="space-y-1">
                {exec.activityLogs.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="w-10 h-10 rounded-xl bg-[#f1f4f9] flex items-center justify-center mx-auto mb-2">
                      <Activity className="w-5 h-5 text-[#c8d2e0]" />
                    </div>
                    <p className="text-sm text-[#4a5568] font-medium">No activity recorded</p>
                  </div>
                ) : exec.activityLogs.map((log) => (
                  <div key={log.id} className="flex items-start gap-3 p-3 rounded-xl hover:bg-[#f8f9fc] transition-colors">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#25488e] mt-2 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[#0f1829]">{ACTION_LABELS[log.action] || log.action}</p>
                      {log.metadata && typeof log.metadata === "object" && (() => {
                        const vn = (log.metadata as Record<string, unknown>).visitNumber;
                        return vn ? <p className="text-xs text-[#8896a9]">Visit {String(vn)}</p> : null;
                      })()}
                      <p className="text-xs text-[#c8d2e0] mt-0.5">{formatTimeAgo(new Date(log.createdAt))}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={!!removeTarget}
        title="Remove Visit"
        message={
          <>
            Remove visit <strong className="text-[#0f1829]">{removeTarget?.visitNumber}</strong> for{" "}
            <strong className="text-[#0f1829]">&quot;{removeTarget?.clientName}&quot;</strong> from this executive?
            This unassigns and permanently deletes the visit record. This action cannot be undone.
          </>
        }
        confirmLabel="Remove Visit"
        danger
        onConfirm={confirmRemoveVisit}
        onCancel={() => setRemoveTarget(null)}
      />
    </Modal>
  );
}
