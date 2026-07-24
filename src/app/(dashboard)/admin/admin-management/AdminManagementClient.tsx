"use client";

import { useState, useCallback, useMemo, memo } from "react";
import {
  Plus, Search, ShieldCheck, Phone, Mail, Key, Edit, PowerOff,
} from "lucide-react";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { AddAdminModal } from "@/components/admin/AddAdminModal";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import toast from "react-hot-toast";
import { cn } from "@/lib/utils/utils";
import { useLiveQuery, fetchJSON } from "@/lib/hooks/useLiveQuery";

interface Admin {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  isActive: boolean;
  createdAt: string;
}

const AdminCard = memo(function AdminCard({
  admin,
  onEdit,
  onResetPassword,
  onToggleActive,
}: {
  admin: Admin;
  onEdit: (admin: Admin) => void;
  onResetPassword: (admin: Admin) => void;
  onToggleActive: (admin: Admin) => void;
}) {
  return (
    <div className="bg-white border border-[#e2e7f0] rounded-xl p-5 hover:border-[#c8d2e0] hover:shadow-md transition-all duration-200 card-hover flex flex-col shadow-sm">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-11 h-11 rounded-xl bg-[#25488e] flex items-center justify-center text-white font-bold text-base flex-shrink-0 shadow-sm">
          {admin.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#0f1829] truncate leading-tight">{admin.name}</p>
          <span className={cn(
            "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border mt-1",
            admin.isActive
              ? "bg-green-50 text-green-700 border-green-200"
              : "bg-[#f1f4f9] text-[#8896a9] border-[#e2e7f0]"
          )}>
            {admin.isActive ? "Active" : "Inactive"}
          </span>
        </div>
      </div>

      <div className="space-y-1.5 mb-4">
        <p className="text-xs text-[#8896a9] flex items-center gap-1.5 truncate">
          <Mail className="w-3 h-3 flex-shrink-0" />
          {admin.email}
        </p>
        {admin.phone && (
          <p className="text-xs text-[#8896a9] flex items-center gap-1.5">
            <Phone className="w-3 h-3 flex-shrink-0" />
            {admin.phone}
          </p>
        )}
      </div>

      <div className="flex gap-2 pt-3 border-t border-[#f1f4f9] mt-auto">
        <button
          onClick={() => onEdit(admin)}
          className="flex-1 py-2 text-xs font-semibold rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#4a5568] hover:text-[#0f1829] transition-all press-effect flex items-center justify-center gap-1.5"
        >
          <Edit className="w-3.5 h-3.5" />
          Edit
        </button>
        <button
          onClick={() => onResetPassword(admin)}
          className="p-2 rounded-lg bg-[#f1f4f9] hover:bg-amber-50 text-[#8896a9] hover:text-amber-600 transition-all press-effect"
          title="Reset Password"
        >
          <Key className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onToggleActive(admin)}
          className={cn(
            "p-2 rounded-lg bg-[#f1f4f9] transition-all press-effect",
            admin.isActive
              ? "text-[#8896a9] hover:text-red-600 hover:bg-red-50"
              : "text-[#8896a9] hover:text-green-600 hover:bg-green-50"
          )}
          title={admin.isActive ? "Deactivate" : "Activate"}
        >
          <PowerOff className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
});

export function AdminManagementClient() {
  const [search, setSearch] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editAdmin, setEditAdmin] = useState<Admin | null>(null);
  const [resetAdmin, setResetAdmin] = useState<Admin | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetting, setResetting] = useState(false);
  const [toggleTarget, setToggleTarget] = useState<Admin | null>(null);

  const fetchAdmins = useCallback(
    () => fetchJSON<{ admins?: Admin[] }>("/api/super-admin/admins"),
    []
  );
  const { data, loading, refresh } = useLiveQuery(fetchAdmins);
  const admins = data?.admins ?? [];

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return admins.filter(
      (a) => a.name.toLowerCase().includes(term) || a.email.toLowerCase().includes(term)
    );
  }, [admins, search]);

  const handleResetPassword = useCallback(async () => {
    if (!resetAdmin) return;
    if (newPassword.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    setResetting(true);
    try {
      const res = await fetch(`/api/super-admin/admins/${resetAdmin.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword }),
      });
      const dataRes = await res.json();
      if (!res.ok) { toast.error(dataRes.error || "Failed"); return; }
      toast.success("Password reset successfully");
      setResetAdmin(null);
      setNewPassword("");
    } catch {
      toast.error("Error resetting password");
    } finally {
      setResetting(false);
    }
  }, [resetAdmin, newPassword]);

  const confirmToggleActive = useCallback(async () => {
    if (!toggleTarget) return;
    try {
      const res = await fetch(`/api/super-admin/admins/${toggleTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !toggleTarget.isActive }),
      });
      if (!res.ok) { toast.error("Failed to update status"); return; }
      toast.success(toggleTarget.isActive ? "Admin deactivated" : "Admin activated");
      refresh();
    } catch {
      toast.error("Error updating status");
    } finally {
      setToggleTarget(null);
    }
  }, [toggleTarget, refresh]);

  const handleEdit = useCallback((admin: Admin) => setEditAdmin(admin), []);
  const handleResetOpen = useCallback((admin: Admin) => { setResetAdmin(admin); setNewPassword(""); }, []);
  const handleToggleActive = useCallback((admin: Admin) => setToggleTarget(admin), []);

  return (
    <div className="space-y-6 animate-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0f1829]">Admin Management</h1>
          <p className="text-[#8896a9] text-sm mt-0.5">
            Super Admin only · Manage Admin accounts · {admins.length} total
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#25488e] hover:bg-[#1e3a72] active:bg-[#172d58] text-white text-sm font-semibold transition-all press-effect shadow-sm self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          Add Admin
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
            <ShieldCheck className="w-8 h-8 text-[#c8d2e0]" />
          </div>
          <p className="text-base font-semibold text-[#4a5568]">
            {search ? "No admins match your search" : "No admins yet"}
          </p>
          {!search && (
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-3 text-sm text-[#25488e] hover:text-[#1e3a72] transition-colors"
            >
              Add the first admin →
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((admin) => (
            <AdminCard
              key={admin.id}
              admin={admin}
              onEdit={handleEdit}
              onResetPassword={handleResetOpen}
              onToggleActive={handleToggleActive}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {showAddModal && (
        <AddAdminModal onClose={() => setShowAddModal(false)} onSuccess={refresh} />
      )}
      {editAdmin && (
        <AddAdminModal admin={editAdmin} onClose={() => setEditAdmin(null)} onSuccess={refresh} />
      )}

      {/* Reset Password Modal */}
      <Modal isOpen={!!resetAdmin} onClose={() => setResetAdmin(null)} title="Reset Password" size="sm">
        <div className="p-5 space-y-4">
          {resetAdmin && (
            <>
              <div className="p-3 rounded-xl bg-[#f8f9fc] border border-[#e2e7f0]">
                <p className="text-xs text-[#8896a9]">Resetting password for</p>
                <p className="text-sm font-semibold text-[#0f1829] mt-0.5">{resetAdmin.name}</p>
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
                  onClick={() => setResetAdmin(null)}
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

      {/* Deactivate/Activate confirmation */}
      <ConfirmDialog
        isOpen={!!toggleTarget}
        title={toggleTarget?.isActive ? "Deactivate Admin" : "Activate Admin"}
        message={
          toggleTarget?.isActive
            ? <>Deactivate <strong className="text-[#0f1829]">&quot;{toggleTarget?.name}&quot;</strong>? They will no longer be able to log in.</>
            : <>Reactivate <strong className="text-[#0f1829]">&quot;{toggleTarget?.name}&quot;</strong>? They will be able to log in again.</>
        }
        confirmLabel={toggleTarget?.isActive ? "Deactivate" : "Activate"}
        danger={!!toggleTarget?.isActive}
        onConfirm={confirmToggleActive}
        onCancel={() => setToggleTarget(null)}
      />
    </div>
  );
}
