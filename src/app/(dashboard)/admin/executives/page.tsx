"use client";

import { useState, useCallback, useMemo, memo } from "react";
import {
  Plus, Search, UserCog, Phone, Mail,
  CheckCircle2, Clock, TrendingUp, Key, Edit, MoreVertical, PowerOff, Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { AddExecutiveModal } from "@/components/admin/AddExecutiveModal";
import { ExecutiveDetailModal } from "@/components/admin/ExecutiveDetailModal";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/DropdownMenu";
import toast from "react-hot-toast";
import { cn } from "@/lib/utils/utils";
import { useLiveQuery, fetchJSON } from "@/lib/hooks/useLiveQuery";

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
  onDelete,
}: {
  exec: Executive;
  onView: (id: string) => void;
  onEdit: (exec: Executive) => void;
  onResetPassword: (exec: Executive) => void;
  onToggleActive: (exec: Executive) => void;
  onDelete: (exec: Executive) => void;
}) {
  return (
    <div className="bg-white border border-[#e2e7f0] rounded-xl p-5 hover:border-[#c8d2e0] hover:shadow-md transition-all duration-200 card-hover flex flex-col shadow-sm">
      {/* Header row */}
      <div className="flex items-start gap-3 mb-4">
        <button
          onClick={() => onView(exec.id)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left group"
        >
          <div className="w-11 h-11 rounded-xl bg-[#25488e] flex items-center justify-center text-white font-bold text-base flex-shrink-0 shadow-sm">
            {exec.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#0f1829] group-hover:text-[#25488e] transition-colors truncate leading-tight">
              {exec.name}
            </p>
            <span className={cn(
              "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border mt-1",
              exec.isActive
                ? "bg-green-50 text-green-700 border-green-200"
                : "bg-[#f1f4f9] text-[#8896a9] border-[#e2e7f0]"
            )}>
              {exec.isActive ? "Active" : "Inactive"}
            </span>
          </div>
        </button>
      </div>

      {/* Contact info */}
      <div className="space-y-1.5 mb-4">
        <p className="text-xs text-[#8896a9] flex items-center gap-1.5 truncate">
          <Mail className="w-3 h-3 flex-shrink-0" />
          {exec.email}
        </p>
        {exec.phone && (
          <p className="text-xs text-[#8896a9] flex items-center gap-1.5">
            <Phone className="w-3 h-3 flex-shrink-0" />
            {exec.phone}
          </p>
        )}
      </div>

      {/* Visit stats */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[
          { label: "Pending", value: exec.pendingCount, icon: Clock, iconColor: "text-amber-500", countColor: "text-amber-600", bg: "bg-amber-50 border-amber-100" },
          { label: "Active", value: exec.inProgressCount, icon: TrendingUp, iconColor: "text-[#25488e]", countColor: "text-[#25488e]", bg: "bg-[#eef2fb] border-[#d4ddf5]" },
          { label: "Done", value: exec.closedCount, icon: CheckCircle2, iconColor: "text-green-600", countColor: "text-green-600", bg: "bg-green-50 border-green-100" },
        ].map(({ label, value, icon: Icon, iconColor, countColor, bg }) => (
          <div key={label} className={cn("text-center p-2.5 rounded-xl border", bg)}>
            <Icon className={cn("w-3.5 h-3.5 mx-auto mb-1", iconColor)} />
            <p className={cn("text-lg font-bold leading-tight", countColor)}>{value}</p>
            <p className="text-[10px] text-[#8896a9] font-medium mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Assigned clients chips */}
      {exec.assignedClients.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {exec.assignedClients.slice(0, 3).map((c) => (
            <span
              key={c.id}
              className="px-2 py-0.5 rounded-md bg-[#f1f4f9] border border-[#e2e7f0] text-[#4a5568] text-xs"
            >
              {c.name}
            </span>
          ))}
          {exec.assignedClients.length > 3 && (
            <span className="px-2 py-0.5 rounded-md bg-[#f1f4f9] border border-[#e2e7f0] text-[#8896a9] text-xs">
              +{exec.assignedClients.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Actions — pushed to bottom */}
      <div className="flex gap-2 pt-3 border-t border-[#f1f4f9] mt-auto">
        <button
          onClick={() => onView(exec.id)}
          className="flex-1 py-2 text-xs font-semibold rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#4a5568] hover:text-[#0f1829] transition-all press-effect"
        >
          View Details
        </button>
        <button
          onClick={() => onEdit(exec)}
          className="p-2 rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#8896a9] hover:text-[#0f1829] transition-all press-effect"
          title="Edit"
        >
          <Edit className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onResetPassword(exec)}
          className="p-2 rounded-lg bg-[#f1f4f9] hover:bg-amber-50 text-[#8896a9] hover:text-amber-600 transition-all press-effect"
          title="Reset Password"
        >
          <Key className="w-3.5 h-3.5" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="p-2 rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#8896a9] hover:text-[#0f1829] transition-all press-effect"
              title="More actions"
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => onToggleActive(exec)}>
              <PowerOff className="w-4 h-4" />
              {exec.isActive ? "Deactivate" : "Activate"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onDelete(exec)} danger>
              <Trash2 className="w-4 h-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
});

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ExecutivesPage() {
  const [search, setSearch] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editExec, setEditExec] = useState<Executive | null>(null);
  const [detailExecId, setDetailExecId] = useState<string | null>(null);
  const [resetExec, setResetExec] = useState<Executive | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetting, setResetting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Executive | null>(null);

  const fetchExecutivesData = useCallback(
    () => fetchJSON<{ executives?: Executive[] }>("/api/admin/executives"),
    []
  );
  const { data, loading, refresh: fetchExecutives } = useLiveQuery(fetchExecutivesData);
  const executives = data?.executives ?? [];

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
  const handleDeleteOpen = useCallback((exec: Executive) => setDeleteTarget(exec), []);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/admin/executives/${deleteTarget.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || "Failed to delete executive"); return; }
      toast.success("Executive deleted");
      fetchExecutives();
    } catch {
      toast.error("Error deleting executive");
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, fetchExecutives]);

  return (
    <div className="space-y-6 animate-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0f1829]">Executives</h1>
          <p className="text-[#8896a9] text-sm mt-0.5">
            Manage field executives · {executives.length} total
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#25488e] hover:bg-[#1e3a72] active:bg-[#172d58] text-white text-sm font-semibold transition-all press-effect shadow-sm self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          Add Executive
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8896a9]" />
        <input
          className="w-full bg-[#f8f9fc] border border-[#e2e7f0] rounded-lg pl-10 pr-4 py-2.5 text-[#0f1829] placeholder-[#8896a9] focus:outline-none focus:border-[#25488e] focus:ring-2 focus:ring-[#25488e]/20 text-sm transition-all"
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
        <div className="text-center py-20 bg-white border border-[#e2e7f0] rounded-xl shadow-sm">
          <div className="w-16 h-16 rounded-2xl bg-[#f1f4f9] flex items-center justify-center mb-4 mx-auto">
            <UserCog className="w-8 h-8 text-[#c8d2e0]" />
          </div>
          <p className="text-base font-semibold text-[#4a5568]">
            {search ? "No executives match your search" : "No executives yet"}
          </p>
          {!search && (
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-3 text-sm text-[#25488e] hover:text-[#1e3a72] transition-colors"
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
              onDelete={handleDeleteOpen}
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
              <div className="p-3 rounded-xl bg-[#f8f9fc] border border-[#e2e7f0]">
                <p className="text-xs text-[#8896a9]">Resetting password for</p>
                <p className="text-sm font-semibold text-[#0f1829] mt-0.5">{resetExec.name}</p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#0f1829] mb-1.5">
                  New Password *
                </label>
                <input
                  type="password"
                  className="w-full bg-[#f8f9fc] border border-[#e2e7f0] rounded-lg px-3.5 py-2.5 text-[#0f1829] placeholder-[#8896a9] focus:outline-none focus:border-[#25488e] focus:ring-2 focus:ring-[#25488e]/15 text-sm transition-all"
                  placeholder="Min 8 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setResetExec(null)}
                  className="flex-1 py-2.5 rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#4a5568] text-sm font-medium transition-all press-effect"
                >
                  Cancel
                </button>
                <button
                  onClick={handleResetPassword}
                  disabled={resetting}
                  className="flex-1 py-2.5 rounded-lg bg-[#800040] hover:bg-[#66002e] disabled:opacity-50 text-white text-sm font-semibold transition-all press-effect"
                >
                  {resetting ? "Resetting…" : "Reset Password"}
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Delete Executive"
        message="Are you sure you want to permanently delete this executive? This action cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
