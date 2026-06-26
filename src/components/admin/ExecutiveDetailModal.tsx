"use client";
import { useState, useEffect, useCallback } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge, ProgressBadge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SkeletonCard, SkeletonTable } from "@/components/ui/Skeleton";
import { Building2, Mail, Phone, Users, CheckCircle2, Clock, TrendingUp, RotateCcw, Activity } from "lucide-react";
import { formatDate, formatTimeAgo } from "@/lib/utils/utils";

interface Executive {
  id: string; name: string; email: string; phone?: string | null; isActive: boolean; createdAt: string;
  visits: { id: string; visitNumber: string; client: { name: string; code: string }; status: string; scheduledDate: string; closedAt?: string | null; progress: number }[];
  activityLogs: { id: string; action: string; metadata: Record<string, unknown>; createdAt: string }[];
  assignedClients: { id: string; name: string }[];
  stats: { totalVisits: number; pendingCount: number; inProgressCount: number; closedCount: number; carryForwardCount: number };
}

interface ExecutiveDetailModalProps {
  executiveId: string | null;
  onClose: () => void;
}

const ACTION_LABELS: Record<string, string> = {
  USER_LOGIN: "Logged in", USER_LOGOUT: "Logged out", VISIT_OPENED: "Opened visit", VISIT_CLOSED: "Closed visit",
  TASK_COMPLETED: "Completed task", SUBTASK_COMPLETED: "Completed subtask", CARRY_FORWARD_APPLIED: "Carry-forward applied",
};

export function ExecutiveDetailModal({ executiveId, onClose }: ExecutiveDetailModalProps) {
  const [exec, setExec] = useState<Executive | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"visits" | "activity">("visits");

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
            <div className="flex items-start gap-4 p-4 bg-slate-800/50 rounded-2xl border border-slate-700/50">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center text-white font-bold text-xl flex-shrink-0">
                {exec.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-lg font-bold text-white">{exec.name}</h3>
                  <Badge variant={exec.isActive ? "active" : "inactive"}>{exec.isActive ? "Active" : "Inactive"}</Badge>
                </div>
                <div className="mt-1 space-y-1">
                  <p className="text-sm text-slate-400 flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" />{exec.email}</p>
                  {exec.phone && <p className="text-sm text-slate-400 flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" />{exec.phone}</p>}
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { icon: Clock, label: "Pending", value: exec.stats.pendingCount, color: "text-amber-400" },
                { icon: TrendingUp, label: "In Progress", value: exec.stats.inProgressCount, color: "text-blue-400" },
                { icon: CheckCircle2, label: "Closed", value: exec.stats.closedCount, color: "text-emerald-400" },
                { icon: RotateCcw, label: "Carry-Fwd", value: exec.stats.carryForwardCount, color: "text-orange-400" },
              ].map(({ icon: Icon, label, value, color }) => (
                <div key={label} className="bg-slate-800/60 rounded-xl p-3 text-center border border-slate-700/50">
                  <Icon className={`w-4 h-4 mx-auto mb-1 ${color}`} />
                  <p className={`text-xl font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{label}</p>
                </div>
              ))}
            </div>

            {/* Assigned Clients */}
            {exec.assignedClients.length > 0 && (
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" />Assigned Clients</p>
                <div className="flex flex-wrap gap-2">
                  {exec.assignedClients.map((c) => (
                    <span key={c.id} className="px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-xs text-slate-300">{c.name}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 p-1 bg-slate-800/50 rounded-xl">
              {(["visits", "activity"] as const).map((tab) => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-colors capitalize ${activeTab === tab ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"}`}>
                  {tab === "visits" ? `Visits (${exec.stats.totalVisits})` : "Activity"}
                </button>
              ))}
            </div>

            {/* Visits Tab */}
            {activeTab === "visits" && (
              <div className="space-y-2">
                {exec.visits.length === 0 ? (
                  <div className="text-center py-8 text-slate-500"><Users className="w-8 h-8 mx-auto mb-2 opacity-40" /><p>No visits assigned</p></div>
                ) : exec.visits.map((v) => (
                  <div key={v.id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/40 border border-slate-700/40 hover:border-slate-600/60 transition-colors">
                    <Building2 className="w-4 h-4 text-slate-600 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-white">{v.client.name}</span>
                        <span className="text-xs text-slate-500">{v.visitNumber}</span>
                        <ProgressBadge progress={v.progress} />
                      </div>
                      <div className="mt-1.5"><ProgressBar value={v.progress} size="sm" /></div>
                      <p className="text-xs text-slate-500 mt-1">{formatDate(new Date(v.scheduledDate))}{v.closedAt && ` · Closed ${formatDate(new Date(v.closedAt))}`}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Activity Tab */}
            {activeTab === "activity" && (
              <div className="space-y-2">
                {exec.activityLogs.length === 0 ? (
                  <div className="text-center py-8 text-slate-500"><Activity className="w-8 h-8 mx-auto mb-2 opacity-40" /><p>No activity recorded</p></div>
                ) : exec.activityLogs.map((log) => (
                  <div key={log.id} className="flex items-start gap-3 p-3 rounded-xl hover:bg-slate-800/30 transition-colors">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-2 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-300">{ACTION_LABELS[log.action] || log.action}</p>
                      {log.metadata && typeof log.metadata === "object" && (() => {
                        const vn = (log.metadata as Record<string, unknown>).visitNumber;
                        return vn ? <p className="text-xs text-slate-500">Visit {String(vn)}</p> : null;
                      })()}
                      <p className="text-xs text-slate-600 mt-0.5">{formatTimeAgo(new Date(log.createdAt))}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
