"use client";

import { useState, useEffect, useCallback, useMemo, memo } from "react";
import {
  Plus, Search, UserCog, Phone, Mail,
  CheckCircle2, Clock, TrendingUp, Key, Edit, PowerOff,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { AddExecutiveModal } from "@/components/admin/AddExecutiveModal";
import { ExecutiveDetailModal } from "@/components/admin/ExecutiveDetailModal";
import { Modal } from "@/components/ui/Modal";
import toast from "react-hot-toast";
import { cn } from "@/lib/utils/utils";

interface Executive {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  isActive: boolean;
  createdAt: string;
  totalVisits: number;
  pendingCount: number;
  inProgressCount: number;
  closedCount: number;
  assignedClients: { id: string; name: string }[];
}

// ─── Executive Card (memoized) ────────────────────────────────────────────────

const ExecutiveCard = memo(function ExecutiveCard({
  exec,
  onView,
  onEdit,
  onResetPassword,
  onToggleActive,
}: {
  exec: Executive;
  onView: (id: string) => void;
  onEdit: (exec: Executive) => void;
  onResetPassword: (exec: Executive) => void;
  onToggleActive: (exec: Executive) => void;
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 transition-all duration-200 card-hover flex flex-col">
      {/* Header row */}
      <div className="flex items-start gap-3 mb-4">
        <button
          onClick={() => onView(exec.id)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left group"
        >
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center text-white font-bold text-base flex-shrink-0 shadow-sm shadow-blue-500/20">
            {exec.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white group-hover:text-blue-400 transition-colors truncate leading-tight">
              {exec.name}
            </p>
            <Badge variant={exec.isActive ? "active" : "inactive"} className="mt-1">
              {exec.isActive ? "Active" : "Inactive"}
            </Badge>
          </div>
        </button>
      </div>

      {/* Contact info */}
      <div className="space-y-1.5 mb-4">
        <p className="text-xs text-slate-500 flex items-center gap-1.5 truncate">
          <Mail className="w-3 h-3 flex-shrink-0" />
          {exec.email}
        </p>
        {exec.phone && (
          <p className="text-xs text-slate-500 flex items-center gap-1.5">
            <Phone className="w-3 h-3 flex-shrink-0" />
            {exec.phone}
          </p>
        )}
      </div>

      {/* Visit stats */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[
          { label: "Pending", value: exec.pendingCount, icon: Clock, color: "text-amber-400" },
          { label: "Active", value: exec.inProgressCount, icon: TrendingUp, color: "text-blue-400" },
          { label: "Done", value: exec.closedCount, icon: CheckCircle2, color: "text-emerald-400" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="text-center p-2.5 rounded-xl bg-slate-800/50 border border-slate-700/30">
            <Icon className={cn("w-3.5 h-3.5 mx-auto mb-1", color)} />
            <p className={cn("text-lg font-bold leading-tight", color)}>{value}</p>
            <p className="text-[10px] text-slate-600 font-medium mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Assigned clients chips */}
      {exec.assignedClients.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {exec.assignedClients.slice(0, 3).map((c) => (
            <span
              key={c.id}
              className="px-2 py-0.5 rounded-md bg-slate-800/70 border border-slate-700/40 text-slate-400 text-xs"
            >
              {c.name}
            </span>
          ))}
          {exec.assignedClients.length > 3 && (
            <span className="px-2 py-0.5 rounded-md bg-slate-800/40 text-slate-500 text-xs">
              +{exec.assignedClients.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Actions — pushed to bottom */}
      <div className="flex gap-2 pt-3 border-t border-slate-800/60 mt-auto">
        <button
          onClick={() => onView(exec.id)}
          className="flex-1 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all press-effect"
        >
          View Details
        </button>
        <button
          onClick={() => onEdit(exec)}
          className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-all press-effect"
          title="Edit"
        >
          <Edit className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onResetPassword(exec)}
          className="p-2 rounded-xl bg-slate-800 hover:bg-amber-500/20 text-slate-400 hover:text-amber-400 transition-all press-effect"
          title="Reset Password"
        >
          <Key className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onToggleActive(exec)}
          className={cn(
            "p-2 rounded-xl bg-slate-800 transition-all press-effect",
            exec.isActive
              ? "text-slate-400 hover:text-red-400 hover:bg-red-500/10"
              : "text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10"
          )}
          title={exec.isActive ? "Deactivate" : "Activate"}
        >
          <PowerOff className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
});

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ExecutivesPage() {
  const [executives, setExecutives] = useState<Executive[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editExec, setEditExec] = useState<Executive | null>(null);
  const [detailExecId, setDetailExecId] = useState<string | null>(null);
  const [resetExec, setResetExec] = useState<Executive | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetting, setResetting] = useState(false);

  const fetchExecutives = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/executives");
      const data = await res.json();
      setExecutives(data.executives ?? []);
    } catch {
      toast.error("Failed to load executives");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchExecutives(); }, [fetchExecutives]);

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return executives.filter(
      (e) => e.name.toLowerCase().includes(term) || e.email.toLowerCase().includes(term)
    );
  }, [executives, search]);

  const handleResetPassword = useCallback(async () => {
    if (!resetExec) return;
    if (newPassword.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    setResetting(true);
    try {
      const res = await fetch(`/api/admin/executives/${resetExec.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Failed"); return; }
      toast.success("Password reset successfully");
      setResetExec(null);
      setNewPassword("");
    } catch {
      toast.error("Error resetting password");
    } finally {
      setResetting(false);
    }
  }, [resetExec, newPassword]);

  const toggleActive = useCallback(async (exec: Executive) => {
    try {
      const res = await fetch(`/api/admin/executives/${exec.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !exec.isActive }),
      });
      if (!res.ok) { toast.error("Failed to update status"); return; }
      toast.success(exec.isActive ? "Executive deactivated" : "Executive activated");
      fetchExecutives();
    } catch {
      toast.error("Error updating status");
    }
  }, [fetchExecutives]);

  const handleView = useCallback((id: string) => setDetailExecId(id), []);
  const handleEdit = useCallback((exec: Executive) => setEditExec(exec), []);
  const handleResetOpen = useCallback((exec: Executive) => { setResetExec(exec); setNewPassword(""); }, []);

  return (
    <div className="space-y-6 animate-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Executives</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Manage field executives · {executives.length} total
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-sm font-semibold transition-all press-effect shadow-sm shadow-blue-600/20 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          Add Executive
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20 text-sm transition-all"
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-2xl">
          <div className="w-16 h-16 rounded-2xl bg-slate-800/60 flex items-center justify-center mb-4 mx-auto">
            <UserCog className="w-8 h-8 text-slate-600" />
          </div>
          <p className="text-base font-semibold text-slate-400">
            {search ? "No executives match your search" : "No executives yet"}
          </p>
          {!search && (
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-3 text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              Add the first executive →
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((exec) => (
            <ExecutiveCard
              key={exec.id}
              exec={exec}
              onView={handleView}
              onEdit={handleEdit}
              onResetPassword={handleResetOpen}
              onToggleActive={toggleActive}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {showAddModal && (
        <AddExecutiveModal onClose={() => setShowAddModal(false)} onSuccess={fetchExecutives} />
      )}
      {editExec && (
        <AddExecutiveModal executive={editExec} onClose={() => setEditExec(null)} onSuccess={fetchExecutives} />
      )}
      <ExecutiveDetailModal executiveId={detailExecId} onClose={() => setDetailExecId(null)} />

      {/* Reset Password Modal */}
      <Modal isOpen={!!resetExec} onClose={() => setResetExec(null)} title="Reset Password" size="sm">
        <div className="p-5 space-y-4">
          {resetExec && (
            <>
              <div className="p-3 rounded-xl bg-slate-800/50 border border-slate-700/50">
                <p className="text-xs text-slate-500">Resetting password for</p>
                <p className="text-sm font-semibold text-white mt-0.5">{resetExec.name}</p>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-semibold">
                  New Password *
                </label>
                <input
                  type="password"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-amber-500/60 focus:ring-2 focus:ring-amber-500/20 text-sm transition-all"
                  placeholder="Min 8 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setResetExec(null)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium transition-all press-effect"
                >
                  Cancel
                </button>
                <button
                  onClick={handleResetPassword}
                  disabled={resetting}
                  className="flex-1 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-semibold transition-all press-effect"
                >
                  {resetting ? "Resetting…" : "Reset Password"}
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
