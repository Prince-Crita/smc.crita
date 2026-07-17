"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Plus, Trash2, Edit, Settings2, ChevronDown, ChevronRight,
  ArrowLeft, Building2, Users, Search, CheckCircle2, RefreshCw,
  ChevronUp, RotateCcw, XCircle,
} from "lucide-react";
import { SkeletonTable, SkeletonCard } from "@/components/ui/Skeleton";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
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
  isDeleted: boolean;
  orderIndex: number;
  isUsingClientSpecific: boolean;
  subtaskCount: number;
  subtasks: SubtaskTemplate[];
}

interface CarryForwardSubtask {
  id: string;
  title: string;
  isCompleted: boolean;
  sourceVisitNumber: string | null;
}

interface CarryForwardGroup {
  taskType: string;
  taskTitle: string;
  subtasks: CarryForwardSubtask[];
}

interface ClientTaskConfig {
  client: { id: string; name: string; code: string; assignedExec: { id: string; name: string } | null };
  taskTypes: TaskTypeConfig[];
  /** Carried-forward tasks on the client's active visit - shown as a
   *  SEPARATE section, never merged with the normal (copied) task list. */
  carryForward: { visitId: string; visitNumber: string; groups: CarryForwardGroup[] } | null;
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
      className="w-full text-left bg-white border border-[#e2e7f0] hover:border-[#25488e]/40 hover:shadow-md rounded-xl p-5 transition-all duration-200 group press-effect"
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#25488e] to-[#3a6abf] flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-sm">
          {client.code.slice(0, 2)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#0f1829] truncate group-hover:text-[#25488e] transition-colors">{client.name}</p>
          <p className="text-xs text-[#8896a9] font-mono mt-0.5">{client.code}</p>
        </div>
        <ChevronRight className="w-4 h-4 text-[#c8d2e0] group-hover:text-[#25488e] transition-colors flex-shrink-0 mt-0.5" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {client.assignedExec && (
          <span className="text-[10px] font-semibold bg-blue-50 border border-blue-200 text-[#25488e] px-2 py-0.5 rounded-md">
            {client.assignedExec.name}
          </span>
        )}
        {hasCustom ? (
          <span className="text-[10px] font-semibold bg-purple-50 border border-purple-200 text-purple-700 px-2 py-0.5 rounded-md">
            {client.clientSubtaskCount} custom subtasks
          </span>
        ) : (
          <span className="text-[10px] font-semibold bg-[#f1f4f9] border border-[#e2e7f0] text-[#8896a9] px-2 py-0.5 rounded-md">
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
      subtask.isActive ? "hover:bg-[#f8f9fc]" : "opacity-50 hover:bg-[#f8f9fc]"
    )}>
      <div className="w-1.5 h-1.5 rounded-full bg-[#c8d2e0] flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className={cn("text-sm", subtask.isActive ? "text-[#0f1829]" : "text-[#8896a9] line-through")}>
          {subtask.title}
        </p>
        {subtask.clientId && (
          <p className="text-[10px] text-purple-600 mt-0.5">Client-specific</p>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onToggle(subtask)}
          className={cn(
            "text-xs px-2 py-1 rounded-lg font-semibold transition-colors",
            subtask.isActive
              ? "bg-[#f1f4f9] text-[#8896a9] hover:text-amber-600 border border-[#e2e7f0]"
              : "bg-green-50 text-green-700 hover:bg-green-100 border border-green-200"
          )}
        >
          {subtask.isActive ? "Disable" : "Enable"}
        </button>
        <button
          onClick={() => onEdit(subtask)}
          className="p-1.5 rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#8896a9] hover:text-[#0f1829] transition-colors border border-[#e2e7f0]"
        >
          <Edit className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onDelete(subtask)}
          className="p-1.5 rounded-lg bg-[#f1f4f9] hover:bg-red-50 text-[#8896a9] hover:text-red-600 transition-colors border border-[#e2e7f0]"
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
  const [renameTaskModal, setRenameTaskModal] = useState<{ taskType: string; title: string } | null>(null);
  const [modalTitle, setModalTitle] = useState("");
  const [saving, setSaving] = useState(false);

  // In-app confirmation dialog state (browser confirm() is not allowed)
  const [confirmAction, setConfirmAction] = useState<
    | { kind: "delete-subtask"; subtask: SubtaskTemplate }
    | { kind: "delete-tasktype"; taskType: string; title: string; isDefault: boolean }
    | null
  >(null);

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

  const handleDeleteSubtask = (subtask: SubtaskTemplate) =>
    setConfirmAction({ kind: "delete-subtask", subtask });

  const doDeleteSubtask = async (subtask: SubtaskTemplate) => {
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

  const handleDeleteTaskType = (taskType: string, taskTitle: string, isDefault: boolean) =>
    setConfirmAction({ kind: "delete-tasktype", taskType, title: taskTitle, isDefault });

  const doDeleteTaskType = async (taskType: string, taskTitle: string) => {
    if (!selectedClient) return;
    try {
      const res = await fetch(
        `/api/admin/task-config/${selectedClient.id}?taskType=${encodeURIComponent(taskType)}`,
        { method: "DELETE" }
      );
      if (!res.ok) { toast.error("Failed to remove task type"); return; }
      toast.success(`Main task "${taskTitle}" removed`);
      fetchConfig(selectedClient.id);
    } catch { toast.error("Error"); }
  };

  // ── Main task rename / restore / reorder ───────────────────────────────────

  const handleRenameTaskType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameTaskModal || !modalTitle.trim() || !selectedClient) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/task-config/${selectedClient.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskType: renameTaskModal.taskType, title: modalTitle.trim() }),
      });
      if (!res.ok) { toast.error("Failed to rename main task"); return; }
      toast.success("Main task renamed");
      setRenameTaskModal(null);
      setModalTitle("");
      fetchConfig(selectedClient.id);
    } catch { toast.error("Error"); }
    finally { setSaving(false); }
  };

  const handleRestoreTaskType = async (taskType: string, taskTitle: string) => {
    if (!selectedClient) return;
    try {
      const res = await fetch(`/api/admin/task-config/${selectedClient.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskType, restore: true }),
      });
      if (!res.ok) { toast.error("Failed to restore main task"); return; }
      toast.success(`Main task "${taskTitle}" restored`);
      fetchConfig(selectedClient.id);
    } catch { toast.error("Error"); }
  };

  const handleMoveTaskType = async (taskType: string, direction: -1 | 1) => {
    if (!selectedClient || !config) return;
    const types = config.taskTypes.map((t) => t.type);
    const idx = types.indexOf(taskType);
    const target = idx + direction;
    if (idx < 0 || target < 0 || target >= types.length) return;
    [types[idx], types[target]] = [types[target], types[idx]];
    try {
      const res = await fetch(`/api/admin/task-config/${selectedClient.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: types }),
      });
      if (!res.ok) { toast.error("Failed to reorder main tasks"); return; }
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
          <h1 className="text-2xl font-bold text-[#0f1829]">Task Configuration</h1>
          <p className="text-[#8896a9] text-sm mt-0.5">
            Configure subtask templates per client · select a client to manage its task types
          </p>
        </div>

        {/* Info banner */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-sm text-[#25488e]">
            <Settings2 className="w-4 h-4 inline mr-1.5" />
            Each client can have its own subtask templates. If no client-specific templates are set,
            global defaults will be used when creating new visits.
          </p>
        </div>

        {/* Search + Refresh */}
        <div className="flex gap-2.5">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8896a9]" />
            <input
              className="w-full bg-white border border-[#e2e7f0] rounded-lg pl-10 pr-4 py-2.5 text-[#0f1829] placeholder-[#8896a9] focus:outline-none focus:border-[#25488e] text-sm transition-colors"
              placeholder="Search clients…"
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
            />
          </div>
          <button
            onClick={fetchClients}
            className="p-2.5 rounded-lg bg-white border border-[#e2e7f0] text-[#8896a9] hover:text-[#0f1829] hover:border-[#c8d2e0] transition-all press-effect"
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
          <div className="text-center py-20 bg-white border border-[#e2e7f0] rounded-xl">
            <div className="w-16 h-16 rounded-2xl bg-[#f1f4f9] flex items-center justify-center mb-4 mx-auto">
              <Building2 className="w-8 h-8 text-[#c8d2e0]" />
            </div>
            <p className="text-base font-semibold text-[#4a5568]">
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
          className="flex items-center gap-1.5 text-sm text-[#25488e] hover:text-[#1e3a72] font-semibold transition-colors mb-3 press-effect"
        >
          <ArrowLeft className="w-4 h-4" />
          All Clients
        </button>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-[#0f1829]">
              {config?.client.name ?? selectedClient?.name}
            </h1>
            <p className="text-[#8896a9] text-sm mt-0.5">
              <span className="font-mono text-[#8896a9]">{config?.client.code ?? selectedClient?.code}</span>
              {config?.client.assignedExec && (
                <span className="ml-2 text-[#25488e] font-semibold">· {config.client.assignedExec.name}</span>
              )}
            </p>
          </div>
          <button
            onClick={() => { setAddTaskTypeModal(true); setModalTitle(""); }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#25488e] hover:bg-[#1e3a72] active:bg-[#162d5c] text-white text-sm font-semibold transition-all press-effect shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Add Task Type
          </button>
        </div>
      </div>

      {/* Info */}
      <div className="bg-[#f8f9fc] border border-[#e2e7f0] rounded-xl p-4">
        <p className="text-sm text-[#4a5568]">
          <Settings2 className="w-4 h-4 inline mr-1.5 text-[#25488e]" />
          Subtasks defined here will be used when creating new visits for <strong className="text-[#0f1829]">{config?.client.name}</strong>.
          Changes do not affect visits already created.
        </p>
      </div>

      {/* Task types */}
      {!configLoading && config?.carryForward && (
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-[#25488e]" />
          <p className="text-sm font-semibold text-[#0f1829]">Copied Tasks</p>
          <p className="text-xs text-[#8896a9]">· normal task configuration for this client</p>
        </div>
      )}
      {configLoading ? <SkeletonTable rows={6} /> : (
        <div className="space-y-3">
          {config?.taskTypes.map(({ type, title, isDefault, isDeleted, isUsingClientSpecific, subtasks }, typeIndex) => {
            const isExpanded = expandedTypes.has(type) && !isDeleted;
            const activeCount = subtasks.filter((t) => t.isActive).length;

            return (
              <div key={type} className={cn(
                "bg-white border border-[#e2e7f0] rounded-xl overflow-hidden shadow-sm",
                isDeleted && "opacity-60"
              )}>
                {/* Task type header */}
                <div className="flex items-center justify-between p-4 bg-[#f8f9fc] gap-2">
                  <button
                    onClick={() => !isDeleted && toggleExpand(type)}
                    className="flex items-center gap-3 flex-1 text-left min-w-0"
                  >
                    <div className="w-8 h-8 rounded-lg bg-[#e2e7f0] flex items-center justify-center flex-shrink-0">
                      {isExpanded
                        ? <ChevronDown className="w-4 h-4 text-[#4a5568]" />
                        : <ChevronRight className="w-4 h-4 text-[#4a5568]" />
                      }
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className={cn("text-sm font-semibold text-[#0f1829]", isDeleted && "line-through")}>{title}</p>
                        {!isDefault && (
                          <span className="text-[10px] font-semibold bg-purple-50 border border-purple-200 text-purple-700 px-1.5 py-0.5 rounded-md">
                            Custom
                          </span>
                        )}
                        {isDeleted && (
                          <span className="text-[10px] font-semibold bg-red-50 border border-red-200 text-red-600 px-1.5 py-0.5 rounded-md">
                            Removed
                          </span>
                        )}
                        {!isDeleted && isUsingClientSpecific && (
                          <span className="text-[10px] font-semibold bg-green-50 border border-green-200 text-green-700 px-1.5 py-0.5 rounded-md flex items-center gap-1">
                            <CheckCircle2 className="w-2.5 h-2.5" />
                            Client override
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#8896a9] mt-0.5">
                        {isDeleted
                          ? "Not included in new visits for this client"
                          : <>
                              {activeCount} active subtask{activeCount !== 1 ? "s" : ""}
                              {!isUsingClientSpecific && <span className="text-[#c8d2e0]"> · using global defaults</span>}
                            </>
                        }
                      </p>
                    </div>
                  </button>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {isDeleted ? (
                      <button
                        onClick={() => handleRestoreTaskType(type, title)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-50 hover:bg-green-100 text-green-700 text-xs font-semibold transition-colors border border-green-200"
                        title="Restore this main task"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Restore
                      </button>
                    ) : (
                      <>
                        {/* Reorder */}
                        <div className="flex flex-col">
                          <button
                            onClick={() => handleMoveTaskType(type, -1)}
                            disabled={typeIndex === 0}
                            className="p-0.5 rounded text-[#8896a9] hover:text-[#25488e] disabled:opacity-30 transition-colors"
                            title="Move up"
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleMoveTaskType(type, 1)}
                            disabled={typeIndex === (config?.taskTypes.length ?? 1) - 1}
                            className="p-0.5 rounded text-[#8896a9] hover:text-[#25488e] disabled:opacity-30 transition-colors"
                            title="Move down"
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <button
                          onClick={() => { setAddSubtaskModal({ taskType: type, title }); setModalTitle(""); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#25488e] hover:bg-[#1e3a72] text-white text-xs font-semibold transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add
                        </button>
                        <button
                          onClick={() => { setRenameTaskModal({ taskType: type, title }); setModalTitle(title); }}
                          className="p-1.5 rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#8896a9] hover:text-[#0f1829] transition-colors border border-[#e2e7f0]"
                          title="Rename this main task"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteTaskType(type, title, isDefault)}
                          className="p-1.5 rounded-lg bg-[#f1f4f9] hover:bg-red-50 text-[#8896a9] hover:text-red-600 transition-colors border border-[#e2e7f0]"
                          title="Remove this main task"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Subtask list */}
                {isExpanded && (
                  <div className="border-t border-[#e2e7f0]">
                    {subtasks.length === 0 ? (
                      <div className="p-6 text-center">
                        <p className="text-[#8896a9] text-sm">No subtasks configured for this client.</p>
                        <button
                          onClick={() => { setAddSubtaskModal({ taskType: type, title }); setModalTitle(""); }}
                          className="mt-2 text-xs text-[#25488e] font-semibold hover:underline"
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

      {/* ── Carry Forward Tasks (separate section - never merged with the
             copied/normal task list above) ──────────────────────────────── */}
      {!configLoading && config?.carryForward && (
        <div className="bg-white border border-orange-200 rounded-xl overflow-hidden shadow-sm">
          <div className="flex items-center justify-between gap-2 px-4 py-3.5 bg-orange-50/60 border-b border-orange-100">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 rounded-lg bg-orange-50 border border-orange-100 flex-shrink-0">
                <RotateCcw className="w-4 h-4 text-[#ff944d]" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#0f1829]">Carry Forward Tasks</p>
                <p className="text-xs text-[#8896a9]">
                  Carried from the previous visit · on visit{" "}
                  <span className="font-mono">{config.carryForward.visitNumber}</span>
                </p>
              </div>
            </div>
            <Link
              href="/admin/carry-forward"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#4a5568] text-xs font-semibold transition-colors border border-[#e2e7f0] flex-shrink-0"
            >
              Manage
            </Link>
          </div>
          <div className="divide-y divide-[#f1f4f9]">
            {config.carryForward.groups.map((group) => (
              <div key={group.taskType} className="px-4 py-3">
                <p className="text-xs font-semibold text-[#4a5568] mb-2">{group.taskTitle}</p>
                <div className="space-y-1.5">
                  {group.subtasks.map((st) => (
                    <div key={st.id} className="flex items-start gap-2.5 flex-wrap">
                      {st.isCompleted ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 text-[#ff944d] mt-0.5 flex-shrink-0" />
                      )}
                      <p className="text-sm text-[#0f1829] flex-1 min-w-0 break-words">{st.title}</p>
                      <span className="flex items-center gap-1 text-[10px] font-semibold text-orange-600 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded-full flex-shrink-0">
                        <RotateCcw className="w-2.5 h-2.5" />
                        Carry Forward
                      </span>
                      {st.sourceVisitNumber && (
                        <span className="text-[10px] text-[#8896a9] font-mono flex-shrink-0">
                          from {st.sourceVisitNumber}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
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
            <label className="block text-xs text-[#8896a9] mb-1.5 font-semibold">Subtask Title *</label>
            <input
              autoFocus
              className="bg-[#f8f9fc] border border-[#e2e7f0] rounded-lg px-3 py-2 text-[#0f1829] placeholder-[#8896a9] focus:outline-none focus:border-[#25488e] text-sm w-full transition-colors"
              placeholder="e.g. Check physical stock counts"
              value={modalTitle}
              onChange={(e) => setModalTitle(e.target.value)}
            />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setAddSubtaskModal(null)}
              className="flex-1 py-2.5 rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#4a5568] text-sm font-semibold transition-colors border border-[#e2e7f0]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 rounded-lg bg-[#25488e] hover:bg-[#1e3a72] disabled:opacity-50 text-white text-sm font-semibold transition-colors"
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
            <label className="block text-xs text-[#8896a9] mb-1.5 font-semibold">Subtask Title *</label>
            <input
              autoFocus
              className="bg-[#f8f9fc] border border-[#e2e7f0] rounded-lg px-3 py-2 text-[#0f1829] placeholder-[#8896a9] focus:outline-none focus:border-[#25488e] text-sm w-full transition-colors"
              value={modalTitle}
              onChange={(e) => setModalTitle(e.target.value)}
            />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setEditSubtaskModal(null)}
              className="flex-1 py-2.5 rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#4a5568] text-sm font-semibold transition-colors border border-[#e2e7f0]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 rounded-lg bg-[#25488e] hover:bg-[#1e3a72] disabled:opacity-50 text-white text-sm font-semibold transition-colors"
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
            <label className="block text-xs text-[#8896a9] mb-1.5 font-semibold">Task Type Name *</label>
            <input
              autoFocus
              className="bg-[#f8f9fc] border border-[#e2e7f0] rounded-lg px-3 py-2 text-[#0f1829] placeholder-[#8896a9] focus:outline-none focus:border-[#25488e] text-sm w-full transition-colors"
              placeholder="e.g. Quality Audit, Safety Inspection"
              value={modalTitle}
              onChange={(e) => setModalTitle(e.target.value)}
            />
            <p className="text-xs text-[#8896a9] mt-1.5">
              This task type will be added to all new visits for <strong className="text-[#0f1829]">{config?.client.name}</strong>.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setAddTaskTypeModal(false)}
              className="flex-1 py-2.5 rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#4a5568] text-sm font-semibold transition-colors border border-[#e2e7f0]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 rounded-lg bg-[#25488e] hover:bg-[#1e3a72] disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              {saving ? "Creating…" : "Add Task Type"}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── Delete Confirmations (in-app, no browser popups) ──────────────── */}
      <ConfirmDialog
        isOpen={!!confirmAction}
        title={confirmAction?.kind === "delete-subtask" ? "Delete Subtask" : "Remove Main Task"}
        message={
          confirmAction?.kind === "delete-subtask" ? (
            <>Delete <strong className="text-[#0f1829]">&quot;{confirmAction.subtask.title}&quot;</strong>? This cannot be undone.</>
          ) : confirmAction?.kind === "delete-tasktype" ? (
            confirmAction.isDefault ? (
              <>Remove main task <strong className="text-[#0f1829]">&quot;{confirmAction.title}&quot;</strong> for this client? New visits will no longer include it. Existing visits are not affected, and you can restore it anytime.</>
            ) : (
              <>Remove task type <strong className="text-[#0f1829]">&quot;{confirmAction.title}&quot;</strong> and all its subtasks for this client? Existing visits are not affected.</>
            )
          ) : null
        }
        confirmLabel={confirmAction?.kind === "delete-subtask" ? "Delete" : "Remove"}
        danger
        onConfirm={async () => {
          if (confirmAction?.kind === "delete-subtask") await doDeleteSubtask(confirmAction.subtask);
          else if (confirmAction?.kind === "delete-tasktype") await doDeleteTaskType(confirmAction.taskType, confirmAction.title);
          setConfirmAction(null);
        }}
        onCancel={() => setConfirmAction(null)}
      />

      {/* ── Rename Main Task Modal ─────────────────────────────────────────── */}
      <Modal
        isOpen={!!renameTaskModal}
        onClose={() => setRenameTaskModal(null)}
        title={`Rename Main Task — ${renameTaskModal?.title}`}
        size="sm"
      >
        <form onSubmit={handleRenameTaskType} className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-[#8896a9] mb-1.5 font-semibold">New Task Name *</label>
            <input
              autoFocus
              className="bg-[#f8f9fc] border border-[#e2e7f0] rounded-lg px-3 py-2 text-[#0f1829] placeholder-[#8896a9] focus:outline-none focus:border-[#25488e] text-sm w-full transition-colors"
              value={modalTitle}
              onChange={(e) => setModalTitle(e.target.value)}
            />
            <p className="text-xs text-[#8896a9] mt-1.5">
              Applies to new visits for <strong className="text-[#0f1829]">{config?.client.name}</strong>. Existing visits keep their current task name.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setRenameTaskModal(null)}
              className="flex-1 py-2.5 rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#4a5568] text-sm font-semibold transition-colors border border-[#e2e7f0]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 rounded-lg bg-[#25488e] hover:bg-[#1e3a72] disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              {saving ? "Saving…" : "Rename"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
