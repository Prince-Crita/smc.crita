"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Plus, Trash2, Edit, Settings2, ChevronDown, ChevronRight,
  ArrowLeft, Building2, Users, Search, CheckCircle2, RefreshCw,
} from "lucide-react";
import { SkeletonTable, SkeletonCard } from "@/components/ui/Skeleton";
import { Modal } from "@/components/ui/Modal";
import toast from "react-hot-toast";
import { cn } from "@/lib/utils/utils";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ClientSummary {
  id: string;
  name: string;
  code: string;
  assignedExec: { id: string; name: string } | null;
  clientSubtaskCount: number;
  globalSubtaskCount: number;
}

interface SubtaskTemplate {
  id: string;
  taskType: string;
  title: string;
  orderIndex: number;
  isActive: boolean;
  clientId: string | null;
}

interface TaskTypeConfig {
  type: string;
  title: string;
  isDefault: boolean;
  isUsingClientSpecific: boolean;
  subtaskCount: number;
  subtasks: SubtaskTemplate[];
}

interface ClientTaskConfig {
  client: { id: string; name: string; code: string; assignedExec: { id: string; name: string } | null };
  taskTypes: TaskTypeConfig[];
}

// ─── Client Card ─────────────────────────────────────────────────────────────

function ClientCard({
  client,
  onSelect,
}: {
  client: ClientSummary;
  onSelect: (c: ClientSummary) => void;
}) {
  const hasCustom = client.clientSubtaskCount > 0;
  return (
    <button
      onClick={() => onSelect(client)}
      className="w-full text-left bg-slate-900 border border-slate-800 hover:border-blue-500/40 rounded-2xl p-5 transition-all duration-200 group press-effect"
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-sm shadow-violet-500/20">
          {client.code.slice(0, 2)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate group-hover:text-blue-300 transition-colors">{client.name}</p>
          <p className="text-xs text-slate-500 font-mono mt-0.5">{client.code}</p>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-blue-400 transition-colors flex-shrink-0 mt-0.5" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {client.assignedExec && (
          <span className="text-[10px] font-semibold bg-blue-500/10 border border-blue-500/20 text-blue-400 px-2 py-0.5 rounded-md">
            {client.assignedExec.name}
          </span>
        )}
        {hasCustom ? (
          <span className="text-[10px] font-semibold bg-violet-500/10 border border-violet-500/20 text-violet-400 px-2 py-0.5 rounded-md">
            {client.clientSubtaskCount} custom subtasks
          </span>
        ) : (
          <span className="text-[10px] font-semibold bg-slate-700/50 border border-slate-700 text-slate-500 px-2 py-0.5 rounded-md">
            Using global defaults
          </span>
        )}
      </div>
    </button>
  );
}

// ─── Subtask Row ─────────────────────────────────────────────────────────────

function SubtaskRow({
  subtask,
  onEdit,
  onDelete,
  onToggle,
}: {
  subtask: SubtaskTemplate;
  onEdit: (s: SubtaskTemplate) => void;
  onDelete: (s: SubtaskTemplate) => void;
  onToggle: (s: SubtaskTemplate) => void;
}) {
  return (
    <div className={cn(
      "flex items-center gap-3 p-3 rounded-xl transition-colors",
      subtask.isActive ? "hover:bg-slate-800/60" : "opacity-50 hover:bg-slate-800/30"
    )}>
      <div className="w-1.5 h-1.5 rounded-full bg-slate-600 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className={cn("text-sm", subtask.isActive ? "text-white" : "text-slate-500 line-through")}>
          {subtask.title}
        </p>
        {subtask.clientId && (
          <p className="text-[10px] text-violet-400 mt-0.5">Client-specific</p>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onToggle(subtask)}
          className={cn(
            "text-xs px-2 py-1 rounded-lg font-medium transition-colors",
            subtask.isActive
              ? "bg-slate-700 text-slate-400 hover:text-amber-400"
              : "bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30"
          )}
        >
          {subtask.isActive ? "Disable" : "Enable"}
        </button>
        <button
          onClick={() => onEdit(subtask)}
          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
        >
          <Edit className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onDelete(subtask)}
          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-red-400 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TaskConfigPage() {
  // ── View state ─────────────────────────────────────────────────────────────
  const [view, setView] = useState<"clients" | "config">("clients");
  const [selectedClient, setSelectedClient] = useState<ClientSummary | null>(null);

  // ── Clients list state ──────────────────────────────────────────────────────
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [clientSearch, setClientSearch] = useState("");
  const [clientsLoading, setClientsLoading] = useState(true);

  // ── Client config state ─────────────────────────────────────────────────────
  const [config, setConfig] = useState<ClientTaskConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());

  // ── Modal state ─────────────────────────────────────────────────────────────
  const [addSubtaskModal, setAddSubtaskModal] = useState<{ taskType: string; title: string } | null>(null);
  const [editSubtaskModal, setEditSubtaskModal] = useState<SubtaskTemplate | null>(null);
  const [addTaskTypeModal, setAddTaskTypeModal] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [saving, setSaving] = useState(false);

  // ── Fetch clients list ──────────────────────────────────────────────────────
  const fetchClients = useCallback(async () => {
    setClientsLoading(true);
    try {
      const res = await fetch("/api/admin/task-config");
      const data = await res.json();
      setClients(data.clients ?? []);
    } catch {
      toast.error("Failed to load clients");
    } finally {
      setClientsLoading(false);
    }
  }, []);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  // ── Fetch client config ─────────────────────────────────────────────────────
  const fetchConfig = useCallback(async (clientId: string) => {
    setConfigLoading(true);
    try {
      const res = await fetch(`/api/admin/task-config/${clientId}`);
      const data = await res.json();
      setConfig(data);
      // Auto-expand all task types
      setExpandedTypes(new Set(data.taskTypes?.map((t: TaskTypeConfig) => t.type) ?? []));
    } catch {
      toast.error("Failed to load task configuration");
    } finally {
      setConfigLoading(false);
    }
  }, []);

  const openClientConfig = useCallback((client: ClientSummary) => {
    setSelectedClient(client);
    setView("config");
    fetchConfig(client.id);
  }, [fetchConfig]);

  const goBack = useCallback(() => {
    setView("clients");
    setSelectedClient(null);
    setConfig(null);
    fetchClients(); // refresh counts
  }, [fetchClients]);

  // ── Subtask operations ──────────────────────────────────────────────────────

  const handleAddSubtask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addSubtaskModal || !modalTitle.trim() || !selectedClient) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/subtask-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskType: addSubtaskModal.taskType,
          title: modalTitle.trim(),
          clientId: selectedClient.id,
        }),
      });
      if (!res.ok) { toast.error("Failed to add subtask"); return; }
      toast.success("Subtask added");
      setAddSubtaskModal(null);
      setModalTitle("");
      fetchConfig(selectedClient.id);
    } catch { toast.error("Error"); }
    finally { setSaving(false); }
  };

  const handleEditSubtask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editSubtaskModal || !modalTitle.trim() || !selectedClient) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/subtask-templates/${editSubtaskModal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: modalTitle.trim() }),
      });
      if (!res.ok) { toast.error("Failed to update subtask"); return; }
      toast.success("Subtask updated");
      setEditSubtaskModal(null);
      setModalTitle("");
      fetchConfig(selectedClient.id);
    } catch { toast.error("Error"); }
    finally { setSaving(false); }
  };

  const handleToggleSubtask = async (subtask: SubtaskTemplate) => {
    if (!selectedClient) return;
    try {
      const res = await fetch(`/api/admin/subtask-templates/${subtask.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !subtask.isActive }),
      });
      if (!res.ok) { toast.error("Failed to update"); return; }
      toast.success(subtask.isActive ? "Subtask disabled" : "Subtask enabled");
      fetchConfig(selectedClient.id);
    } catch { toast.error("Error"); }
  };

  const handleDeleteSubtask = async (subtask: SubtaskTemplate) => {
    if (!confirm(`Delete "${subtask.title}"? This cannot be undone.`)) return;
    if (!selectedClient) return;
    try {
      const res = await fetch(`/api/admin/subtask-templates/${subtask.id}`, { method: "DELETE" });
      if (!res.ok) { toast.error("Failed to delete"); return; }
      toast.success("Subtask deleted");
      fetchConfig(selectedClient.id);
    } catch { toast.error("Error"); }
  };

  // ── Custom task type operations ─────────────────────────────────────────────

  const handleAddTaskType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalTitle.trim() || !selectedClient) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/task-config/${selectedClient.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: modalTitle.trim() }),
      });
      if (!res.ok) { toast.error("Failed to add task type"); return; }
      toast.success(`Task type "${modalTitle}" added`);
      setAddTaskTypeModal(false);
      setModalTitle("");
      fetchConfig(selectedClient.id);
    } catch { toast.error("Error"); }
    finally { setSaving(false); }
  };

  const handleDeleteTaskType = async (taskType: string, taskTitle: string) => {
    if (!confirm(`Remove task type "${taskTitle}" and all its subtasks for this client? This cannot be undone.`)) return;
    if (!selectedClient) return;
    try {
      const res = await fetch(
        `/api/admin/task-config/${selectedClient.id}?taskType=${encodeURIComponent(taskType)}`,
        { method: "DELETE" }
      );
      if (!res.ok) { toast.error("Failed to remove task type"); return; }
      toast.success(`Task type "${taskTitle}" removed`);
      fetchConfig(selectedClient.id);
    } catch { toast.error("Error"); }
  };

  // ── Toggle expand ───────────────────────────────────────────────────────────
  const toggleExpand = (type: string) => {
    setExpandedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  };

  // ── Filtered clients ────────────────────────────────────────────────────────
  const filteredClients = clients.filter((c) => {
    const term = clientSearch.toLowerCase();
    return (
      c.name.toLowerCase().includes(term) ||
      c.code.toLowerCase().includes(term) ||
      (c.assignedExec?.name ?? "").toLowerCase().includes(term)
    );
  });

  // ─── Render: Client List ────────────────────────────────────────────────────

  if (view === "clients") {
    return (
      <div className="space-y-6 animate-in">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-white">Task Configuration</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Configure subtask templates per client · select a client to manage its task types
          </p>
        </div>

        {/* Info banner */}
        <div className="bg-slate-900/50 border border-blue-500/20 rounded-2xl p-4">
          <p className="text-sm text-blue-300">
            <Settings2 className="w-4 h-4 inline mr-1.5" />
            Each client can have its own subtask templates. If no client-specific templates are set,
            global defaults will be used when creating new visits.
          </p>
        </div>

        {/* Search + Refresh */}
        <div className="flex gap-2.5">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/60 text-sm"
              placeholder="Search clients…"
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
            />
          </div>
          <button
            onClick={fetchClients}
            className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition-all press-effect"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Client Grid */}
        {clientsLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : filteredClients.length === 0 ? (
          <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-2xl">
            <div className="w-16 h-16 rounded-2xl bg-slate-800/60 flex items-center justify-center mb-4 mx-auto">
              <Building2 className="w-8 h-8 text-slate-600" />
            </div>
            <p className="text-base font-semibold text-slate-400">
              {clientSearch ? "No clients match your search" : "No clients found"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredClients.map((c) => (
              <ClientCard key={c.id} client={c} onSelect={openClientConfig} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── Render: Client Task Config ─────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-in">
      {/* Back + Header */}
      <div>
        <button
          onClick={goBack}
          className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors mb-3 press-effect"
        >
          <ArrowLeft className="w-4 h-4" />
          All Clients
        </button>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-white">
              {config?.client.name ?? selectedClient?.name}
            </h1>
            <p className="text-slate-500 text-sm mt-0.5">
              <span className="font-mono text-slate-600">{config?.client.code ?? selectedClient?.code}</span>
              {config?.client.assignedExec && (
                <span className="ml-2 text-blue-400">· {config.client.assignedExec.name}</span>
              )}
            </p>
          </div>
          <button
            onClick={() => { setAddTaskTypeModal(true); setModalTitle(""); }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 active:bg-violet-700 text-white text-sm font-semibold transition-all press-effect shadow-sm shadow-violet-600/20"
          >
            <Plus className="w-4 h-4" />
            Add Task Type
          </button>
        </div>
      </div>

      {/* Info */}
      <div className="bg-slate-900/50 border border-violet-500/20 rounded-2xl p-4">
        <p className="text-sm text-violet-300">
          <Settings2 className="w-4 h-4 inline mr-1.5" />
          Subtasks defined here will be used when creating new visits for <strong>{config?.client.name}</strong>.
          Changes do not affect visits already created.
        </p>
      </div>

      {/* Task types */}
      {configLoading ? <SkeletonTable rows={6} /> : (
        <div className="space-y-3">
          {config?.taskTypes.map(({ type, title, isDefault, isUsingClientSpecific, subtasks }) => {
            const isExpanded = expandedTypes.has(type);
            const activeCount = subtasks.filter((t) => t.isActive).length;

            return (
              <div key={type} className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                {/* Task type header */}
                <div className="flex items-center justify-between p-4">
                  <button
                    onClick={() => toggleExpand(type)}
                    className="flex items-center gap-3 flex-1 text-left"
                  >
                    <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center flex-shrink-0">
                      {isExpanded
                        ? <ChevronDown className="w-4 h-4 text-slate-400" />
                        : <ChevronRight className="w-4 h-4 text-slate-400" />
                      }
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-white">{title}</p>
                        {!isDefault && (
                          <span className="text-[10px] font-semibold bg-violet-500/10 border border-violet-500/20 text-violet-400 px-1.5 py-0.5 rounded-md">
                            Custom
                          </span>
                        )}
                        {isUsingClientSpecific && (
                          <span className="text-[10px] font-semibold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-md flex items-center gap-1">
                            <CheckCircle2 className="w-2.5 h-2.5" />
                            Client override
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {activeCount} active subtask{activeCount !== 1 ? "s" : ""}
                        {!isUsingClientSpecific && <span className="text-slate-600"> · using global defaults</span>}
                      </p>
                    </div>
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setAddSubtaskModal({ taskType: type, title }); setModalTitle(""); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add
                    </button>
                    {!isDefault && (
                      <button
                        onClick={() => handleDeleteTaskType(type, title)}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-red-500/15 text-slate-500 hover:text-red-400 transition-colors"
                        title="Remove this task type"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Subtask list */}
                {isExpanded && (
                  <div className="border-t border-slate-800">
                    {subtasks.length === 0 ? (
                      <div className="p-6 text-center">
                        <p className="text-slate-600 text-sm">No subtasks configured for this client.</p>
                        <button
                          onClick={() => { setAddSubtaskModal({ taskType: type, title }); setModalTitle(""); }}
                          className="mt-2 text-xs text-blue-400 hover:underline"
                        >
                          Add the first subtask →
                        </button>
                      </div>
                    ) : (
                      <div className="p-2 space-y-1">
                        {subtasks.map((st) => (
                          <SubtaskRow
                            key={st.id}
                            subtask={st}
                            onEdit={(s) => { setEditSubtaskModal(s); setModalTitle(s.title); }}
                            onDelete={handleDeleteSubtask}
                            onToggle={handleToggleSubtask}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add Subtask Modal ──────────────────────────────────────────────── */}
      <Modal
        isOpen={!!addSubtaskModal}
        onClose={() => setAddSubtaskModal(null)}
        title={`Add Subtask — ${addSubtaskModal?.title}`}
        size="sm"
      >
        <form onSubmit={handleAddSubtask} className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 font-medium">Subtask Title *</label>
            <input
              autoFocus
              className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 text-sm w-full"
              placeholder="e.g. Check physical stock counts"
              value={modalTitle}
              onChange={(e) => setModalTitle(e.target.value)}
            />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setAddSubtaskModal(null)}
              className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              {saving ? "Adding…" : "Add Subtask"}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── Edit Subtask Modal ─────────────────────────────────────────────── */}
      <Modal
        isOpen={!!editSubtaskModal}
        onClose={() => setEditSubtaskModal(null)}
        title="Edit Subtask"
        size="sm"
      >
        <form onSubmit={handleEditSubtask} className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 font-medium">Subtask Title *</label>
            <input
              autoFocus
              className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 text-sm w-full"
              value={modalTitle}
              onChange={(e) => setModalTitle(e.target.value)}
            />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setEditSubtaskModal(null)}
              className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── Add Task Type Modal ────────────────────────────────────────────── */}
      <Modal
        isOpen={addTaskTypeModal}
        onClose={() => setAddTaskTypeModal(false)}
        title="Add New Task Type"
        size="sm"
      >
        <form onSubmit={handleAddTaskType} className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 font-medium">Task Type Name *</label>
            <input
              autoFocus
              className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 text-sm w-full"
              placeholder="e.g. Quality Audit, Safety Inspection"
              value={modalTitle}
              onChange={(e) => setModalTitle(e.target.value)}
            />
            <p className="text-xs text-slate-500 mt-1.5">
              This task type will be added to all new visits for <strong className="text-slate-300">{config?.client.name}</strong>.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setAddTaskTypeModal(false)}
              className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              {saving ? "Creating…" : "Add Task Type"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
