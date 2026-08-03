"use client";

import { useState, useEffect, useCallback, useMemo, memo } from "react";
import {
  Plus, Search, Building2, Mail, Phone, Users,
  Archive, RefreshCw, Edit, MapPin, Copy, MoreVertical, Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { AddClientModal } from "@/components/admin/AddClientModal";
import toast from "react-hot-toast";
import { formatDate, cn } from "@/lib/utils/utils";
import { useLiveQuery, fetchJSON } from "@/lib/hooks/useLiveQuery";

interface Client {
  id: string;
  name: string;
  code: string;
  contactPerson: string;
  address: string;
  phone?: string | null;
  email?: string | null;
  reportEmails: string[];
  assignedExecId?: string | null;
  assignedExec?: { id: string; name: string; email: string } | null;
  startDate?: string | null;
  endDate?: string | null;
  isArchived: boolean;
  createdAt: string;
  visitCount: number;
  recentVisitDate?: string | null;
  /** P6: "NO_MEETING" = latest visit closed without MD meeting, "PENDING" = MD answer still pending */
  mdMeetingStatus?: "NO_MEETING" | "PENDING" | null;
}

interface Executive { id: string; name: string }

// ─── Client Card (memoized) ───────────────────────────────────────────────────

const ClientCard = memo(function ClientCard({
  client,
  onEdit,
  onArchive,
  onUnarchive,
  onDuplicate,
  onDelete,
}: {
  client: Client;
  onEdit: (client: Client) => void;
  onArchive: (client: Client) => void;
  onUnarchive: (client: Client) => void;
  onDuplicate: (client: Client) => void;
  onDelete: (client: Client) => void;
}) {
  return (
    <div className={cn(
      "bg-white border rounded-xl p-5 transition-all duration-200 card-hover flex flex-col shadow-sm",
      client.isArchived
        ? "border-[#e2e7f0] opacity-60"
        : "border-[#e2e7f0] hover:border-[#c8d2e0] hover:shadow-md"
    )}>
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <div className="w-11 h-11 rounded-xl bg-[#800040] flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-sm">
          {client.code.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-[#0f1829] truncate leading-tight">{client.name}</p>
          <p className="text-xs text-[#8896a9] mt-0.5 font-mono">{client.code}</p>
          {client.mdMeetingStatus === "NO_MEETING" && (
            <span className="inline-block mt-1 text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full">
              Closed without MD Meeting
            </span>
          )}
          {client.mdMeetingStatus === "PENDING" && (
            <span className="inline-block mt-1 text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
              MD Meeting Pending
            </span>
          )}
        </div>
        {client.isArchived && <Badge variant="inactive">Archived</Badge>}
      </div>

      {/* Contact info */}
      <div className="space-y-1.5 mb-4">
        <p className="text-xs text-[#8896a9] flex items-center gap-1.5">
          <Users className="w-3 h-3 flex-shrink-0" />
          {client.contactPerson}
        </p>
        {client.email && (
          <p className="text-xs text-[#8896a9] flex items-center gap-1.5">
            <Mail className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{client.email}</span>
          </p>
        )}
        {client.phone && (
          <p className="text-xs text-[#8896a9] flex items-center gap-1.5">
            <Phone className="w-3 h-3 flex-shrink-0" />
            {client.phone}
          </p>
        )}
        {client.address && (
          <p className="text-xs text-[#8896a9] flex items-center gap-1.5">
            <MapPin className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{client.address}</span>
          </p>
        )}
        {client.assignedExec && (
          <p className="text-xs text-[#25488e] flex items-center gap-1.5">
            <span className="text-[10px] font-bold bg-[#eef2fb] border border-[#d4ddf5] px-1.5 py-0.5 rounded-md text-[#25488e]">
              EXEC
            </span>
            {client.assignedExec.name}
          </p>
        )}
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-0 p-2.5 rounded-xl bg-[#f8f9fc] border border-[#e2e7f0] mb-4">
        <div className="text-center flex-1">
          <p className="text-lg font-bold text-[#0f1829] leading-tight">{client.visitCount}</p>
          <p className="text-[10px] text-[#8896a9] font-medium">Visits</p>
        </div>
        {client.reportEmails.length > 0 && (
          <div className="text-center flex-1 border-l border-[#e2e7f0]">
            <p className="text-lg font-bold text-[#25488e] leading-tight">{client.reportEmails.length}</p>
            <p className="text-[10px] text-[#8896a9] font-medium">Recipients</p>
          </div>
        )}
        {client.recentVisitDate && (
          <div className="text-center flex-1 border-l border-[#e2e7f0]">
            <p className="text-xs font-semibold text-[#4a5568] leading-tight">
              {formatDate(new Date(client.recentVisitDate))}
            </p>
            <p className="text-[10px] text-[#8896a9] font-medium">Last Visit</p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-3 border-t border-[#f1f4f9] mt-auto">
        <button
          onClick={() => onEdit(client)}
          className="flex-1 py-2 text-xs font-semibold rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#4a5568] hover:text-[#0f1829] transition-all press-effect flex items-center justify-center gap-1.5"
        >
          <Edit className="w-3 h-3" />
          Edit
        </button>
        {client.isArchived ? (
          <button
            onClick={() => onUnarchive(client)}
            className="flex-1 py-2 text-xs font-semibold rounded-lg bg-green-50 hover:bg-green-100 text-green-700 transition-all press-effect"
          >
            Restore
          </button>
        ) : (
          <>
            <button
              onClick={() => onDuplicate(client)}
              className="p-2 rounded-lg bg-[#f1f4f9] hover:bg-[#eef2fb] text-[#8896a9] hover:text-[#25488e] transition-all press-effect"
              title="Duplicate client (weekly recurring)"
            >
              <Copy className="w-3.5 h-3.5" />
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
                <DropdownMenuItem onSelect={() => onArchive(client)}>
                  <Archive className="w-4 h-4" />
                  Archive
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onDelete(client)} danger>
                  <Trash2 className="w-4 h-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </div>
  );
});

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ClientsPage() {
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [duplicateClient, setDuplicateClient] = useState<Client | null>(null);
  const [dupName, setDupName] = useState("");
  // Same two fields as the Edit Client popup (Client.startDate / Client.endDate)
  // — they drive the duplicated client's engagement window AND the visit that
  // is created from it, so no follow-up "Edit Client" is ever needed.
  const [dupStartDate, setDupStartDate] = useState("");
  const [dupEndDate, setDupEndDate] = useState("");
  const [dupDateError, setDupDateError] = useState("");
  const [duplicating, setDuplicating] = useState(false);
  // Carry-forward selection step: pending tasks from the source client's
  // latest visit; the admin ticks which become Carry Forward in the copy.
  const [dupPendingTasks, setDupPendingTasks] = useState<
    { taskType: string; title: string; incompleteCount: number }[]
  >([]);
  const [dupPendingLoading, setDupPendingLoading] = useState(false);
  const [dupSelectedTypes, setDupSelectedTypes] = useState<Set<string>>(new Set());

  const fetchClientsData = useCallback(async () => {
    const [clientData, execData] = await Promise.all([
      fetchJSON<{ clients?: Client[] }>(`/api/admin/clients?archived=${showArchived}`),
      fetchJSON<{ executives?: Executive[] }>("/api/admin/executives"),
    ]);
    return {
      clients: (clientData.clients ?? []) as Client[],
      executives: (execData.executives ?? []) as Executive[],
    };
  }, [showArchived]);

  const { data: clientsData, loading, error, refresh: fetchAll } = useLiveQuery(fetchClientsData);
  const clients = clientsData?.clients ?? [];
  const executives = clientsData?.executives ?? [];

  useEffect(() => {
    if (error) toast.error("Failed to load data");
  }, [error]);

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        c.code.toLowerCase().includes(term) ||
        c.contactPerson.toLowerCase().includes(term)
    );
  }, [clients, search]);

  const [archiveTarget, setArchiveTarget] = useState<Client | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);

  const handleArchive = useCallback((client: Client) => setArchiveTarget(client), []);
  const handleDelete = useCallback((client: Client) => setDeleteTarget(client), []);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/admin/clients/${deleteTarget.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || "Failed to delete client"); return; }
      toast.success("Client deleted");
      fetchAll();
    } catch {
      toast.error("Error deleting client");
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, fetchAll]);

  const confirmArchive = useCallback(async () => {
    if (!archiveTarget) return;
    try {
      const res = await fetch(`/api/admin/clients/${archiveTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isArchived: true }),
      });
      if (!res.ok) { toast.error("Failed to archive"); return; }
      toast.success("Client archived");
      fetchAll();
    } catch {
      toast.error("Error archiving client");
    } finally {
      setArchiveTarget(null);
    }
  }, [archiveTarget, fetchAll]);

  const handleUnarchive = useCallback(async (client: Client) => {
    try {
      const res = await fetch(`/api/admin/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isArchived: false }),
      });
      if (!res.ok) { toast.error("Failed to restore"); return; }
      toast.success("Client restored");
      fetchAll();
    } catch {
      toast.error("Error restoring client");
    }
  }, [fetchAll]);

  const handleEdit = useCallback((client: Client) => setEditClient(client), []);

  const handleDuplicateOpen = useCallback(async (client: Client) => {
    setDuplicateClient(client);
    setDupName(`${client.name} (Copy)`);
    // Prefill from the source client, exactly like Edit Client does — the
    // admin usually just shifts the window forward by a week.
    setDupStartDate(client.startDate ? new Date(client.startDate).toISOString().split("T")[0] : "");
    setDupEndDate(client.endDate ? new Date(client.endDate).toISOString().split("T")[0] : "");
    setDupDateError("");
    setDupSelectedTypes(new Set());
    setDupPendingTasks([]);
    setDupPendingLoading(true);
    try {
      const data = await fetchJSON<{ pendingTasks?: { taskType: string; title: string; incompleteCount: number }[] }>(
        `/api/admin/clients/${client.id}/duplicate`
      );
      setDupPendingTasks(data.pendingTasks ?? []);
    } catch {
      setDupPendingTasks([]);
    } finally {
      setDupPendingLoading(false);
    }
  }, []);

  const toggleDupTaskType = useCallback((taskType: string) => {
    setDupSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(taskType)) next.delete(taskType); else next.add(taskType);
      return next;
    });
  }, []);

  const handleDuplicateSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!duplicateClient || !dupName.trim()) return;

    // Same validation rule the visit APIs already enforce.
    if (dupStartDate && dupEndDate && new Date(dupEndDate) < new Date(dupStartDate)) {
      setDupDateError("Visit End Date cannot be before the Visit Start Date");
      return;
    }
    setDupDateError("");

    setDuplicating(true);
    try {
      const res = await fetch(`/api/admin/clients/${duplicateClient.id}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: dupName.trim(),
          startDate: dupStartDate || null,
          endDate: dupEndDate || null,
          carryForwardTaskTypes: [...dupSelectedTypes],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data?.error || "Failed to duplicate client"); return; }
      toast.success(`Client duplicated as "${dupName.trim()}"${data?.visitCreated ? ` · Visit ${data.visitCreated.visitNumber} created` : ""}`);
      setDuplicateClient(null);
      fetchAll();
    } catch {
      toast.error("Error duplicating client");
    } finally {
      setDuplicating(false);
    }
  }, [duplicateClient, dupName, dupStartDate, dupEndDate, dupSelectedTypes, fetchAll]);

  return (
    <div className="space-y-6 animate-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0f1829]">Clients</h1>
          <p className="text-[#8896a9] text-sm mt-0.5">
            Manage client accounts · {clients.length} {showArchived ? "archived" : "active"}
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#25488e] hover:bg-[#1e3a72] active:bg-[#172d58] text-white text-sm font-semibold transition-all press-effect shadow-sm self-start"
        >
          <Plus className="w-4 h-4" />
          Add Client
        </button>
      </div>

      {/* Controls */}
      <div className="flex gap-2.5">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8896a9]" />
          <input
            className="w-full bg-[#f8f9fc] border border-[#e2e7f0] rounded-lg pl-10 pr-4 py-2.5 text-[#0f1829] placeholder-[#8896a9] focus:outline-none focus:border-[#25488e] focus:ring-2 focus:ring-[#25488e]/20 text-sm transition-all"
            placeholder="Search clients..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          onClick={() => setShowArchived(!showArchived)}
          className={cn(
            "flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg border text-sm font-medium transition-all press-effect",
            showArchived
              ? "bg-amber-50 border-amber-200 text-amber-700"
              : "bg-[#f1f4f9] border-[#e2e7f0] text-[#4a5568] hover:text-[#0f1829] hover:border-[#c8d2e0]"
          )}
        >
          <Archive className="w-4 h-4" />
          <span className="hidden sm:inline">{showArchived ? "Archived" : "Active"}</span>
        </button>
        <button
          onClick={fetchAll}
          className="p-2.5 rounded-lg bg-[#f1f4f9] border border-[#e2e7f0] text-[#8896a9] hover:text-[#0f1829] hover:border-[#c8d2e0] transition-all press-effect"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(5)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 bg-white border border-[#e2e7f0] rounded-xl shadow-sm">
          <div className="w-16 h-16 rounded-2xl bg-[#f1f4f9] flex items-center justify-center mb-4 mx-auto">
            <Building2 className="w-8 h-8 text-[#c8d2e0]" />
          </div>
          <p className="text-base font-semibold text-[#4a5568]">
            {search ? "No clients match your search" : showArchived ? "No archived clients" : "No active clients"}
          </p>
          {!search && !showArchived && (
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-3 text-sm text-[#25488e] hover:text-[#1e3a72] transition-colors"
            >
              Add the first client →
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((client) => (
            <ClientCard
              key={client.id}
              client={client}
              onEdit={handleEdit}
              onArchive={handleArchive}
              onUnarchive={handleUnarchive}
              onDuplicate={handleDuplicateOpen}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {showAddModal && (
        <AddClientModal executives={executives} onClose={() => setShowAddModal(false)} onSuccess={fetchAll} />
      )}
      {editClient && (
        <AddClientModal client={editClient} executives={executives} onClose={() => setEditClient(null)} onSuccess={fetchAll} />
      )}

      {/* ── Archive Confirmation ───────────────────────────────────────────── */}
      <ConfirmDialog
        isOpen={!!archiveTarget}
        title="Archive Client"
        message={<>Archive client <strong className="text-[#0f1829]">&quot;{archiveTarget?.name}&quot;</strong>? They will be hidden from active lists. You can restore them later.</>}
        confirmLabel="Archive"
        danger
        onConfirm={confirmArchive}
        onCancel={() => setArchiveTarget(null)}
      />

      {/* ── Delete Confirmation ────────────────────────────────────────────── */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Delete Client"
        message="Are you sure you want to permanently delete this client? This action cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* ── Duplicate Client Modal ─────────────────────────────────────────── */}
      <Modal
        isOpen={!!duplicateClient}
        onClose={() => setDuplicateClient(null)}
        title={`Duplicate Client — ${duplicateClient?.name}`}
        size="sm"
      >
        <form onSubmit={handleDuplicateSubmit} className="p-5 space-y-4">
          <p className="text-xs text-[#8896a9] leading-relaxed">
            Copies main tasks, subtasks, assigned executive and visit configuration.
            The first visit is created immediately and appears on the dashboards and calendar.
          </p>
          <div>
            <label className="block text-xs text-[#8896a9] mb-1.5 font-semibold">New Client Name *</label>
            <input
              autoFocus
              required
              className="bg-[#f8f9fc] border border-[#e2e7f0] rounded-lg px-3 py-2 text-[#0f1829] placeholder-[#8896a9] focus:outline-none focus:border-[#25488e] text-sm w-full transition-colors"
              value={dupName}
              onChange={(e) => setDupName(e.target.value)}
            />
          </div>
          {/* Visit Start / End Date — identical fields, validation and data
              model as the Edit Client popup. Saved on the duplicated client
              AND applied to the visit created for it, so the duplicate never
              needs a follow-up edit. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[#8896a9] mb-1.5 font-semibold">Visit Start Date</label>
              <input
                type="date"
                className="bg-[#f8f9fc] border border-[#e2e7f0] rounded-lg px-3 py-2 text-[#0f1829] focus:outline-none focus:border-[#25488e] text-sm w-full transition-colors"
                value={dupStartDate}
                onChange={(e) => { setDupStartDate(e.target.value); setDupDateError(""); }}
              />
            </div>
            <div>
              <label className="block text-xs text-[#8896a9] mb-1.5 font-semibold">Visit End Date</label>
              <input
                type="date"
                min={dupStartDate || undefined}
                className="bg-[#f8f9fc] border border-[#e2e7f0] rounded-lg px-3 py-2 text-[#0f1829] focus:outline-none focus:border-[#25488e] text-sm w-full transition-colors"
                value={dupEndDate}
                onChange={(e) => { setDupEndDate(e.target.value); setDupDateError(""); }}
              />
            </div>
          </div>
          {dupDateError
            ? <p className="text-xs text-red-600 -mt-1">{dupDateError}</p>
            : <p className="text-xs text-[#8896a9] -mt-1">Leave empty to schedule the first visit for today.</p>}

          {/* ── Step 3: Carry Forward pending tasks ─────────────────────── */}
          <div>
            <label className="block text-xs text-[#8896a9] mb-1.5 font-semibold">Carry Forward Pending Tasks</label>
            {dupPendingLoading ? (
              <p className="text-xs text-[#8896a9] py-2">Checking previous visit…</p>
            ) : dupPendingTasks.length === 0 ? (
              <p className="text-xs text-[#8896a9] py-2 px-3 bg-[#f8f9fc] border border-[#e2e7f0] rounded-lg">
                No pending tasks in the previous visit — nothing to carry forward.
              </p>
            ) : (
              <>
                <div className="space-y-1.5 max-h-44 overflow-y-auto border border-[#e2e7f0] rounded-lg p-2 bg-[#f8f9fc]">
                  {dupPendingTasks.map((t) => (
                    <label
                      key={t.taskType}
                      className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={dupSelectedTypes.has(t.taskType)}
                        onChange={() => toggleDupTaskType(t.taskType)}
                        className="w-4 h-4 rounded border-[#c8d2e0] text-[#25488e] accent-[#25488e]"
                      />
                      <span className="text-sm text-[#0f1829] flex-1">{t.title}</span>
                      <span className="text-[10px] font-semibold text-[#ff944d] bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded-full">
                        {t.incompleteCount} pending
                      </span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-[#8896a9] mt-1.5">
                  Only the selected tasks become Carry Forward in the duplicated visit — the rest start fresh.
                </p>
              </>
            )}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setDuplicateClient(null)}
              className="flex-1 py-2.5 rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#4a5568] text-sm font-semibold transition-colors border border-[#e2e7f0]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={duplicating}
              className="flex-1 py-2.5 rounded-lg bg-[#25488e] hover:bg-[#1e3a72] disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              {duplicating ? "Duplicating…" : "Duplicate"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
