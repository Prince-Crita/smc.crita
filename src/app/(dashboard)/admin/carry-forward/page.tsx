"use client";

import { RotateCcw, CheckCircle2, XCircle, ChevronDown, ChevronRight, Plus, Trash2, Settings2 } from "lucide-react";
import Link from "next/link";
import { formatDate } from "@/lib/utils/utils";
import { cn } from "@/lib/utils/utils";
import { useLiveQuery, fetchJSON } from "@/lib/hooks/useLiveQuery";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

// ─── Types (mirrors GET /api/admin/carry-forward response) ────────────────────

interface CarriedItem {
  id: string;
  title: string;
  taskTitle: string;
  taskType: string;
  isCompleted: boolean;
  sourceVisitNumber: string;
  sourceClosedAt: string | null;
}

interface VisitTask {
  id: string;
  taskType: string;
  title: string;
}

interface CarryForwardGroup {
  visitId: string;
  visitNumber: string;
  clientName: string;
  clientCode: string;
  executiveName: string;
  visitStatus: string;
  scheduledDate: string;
  /** Set for visit-level-only carry-forwards, e.g. "Missed Weekly Visit" (Business Rule 2) */
  reason: string | null;
  /** Main tasks of the destination (next) visit - used by the planning actions */
  visitTasks: VisitTask[];
  carriedItems: CarriedItem[];
}

interface CarryForwardResponse {
  carryForwards: CarryForwardGroup[];
  logs: unknown[];
}

async function fetchCarryForward(): Promise<CarryForwardResponse> {
  return fetchJSON<CarryForwardResponse>("/api/admin/carry-forward");
}

export default function CarryForwardPage() {
  // Fetch once on mount; refreshed only by explicit mutations. No polling.
  const { data, loading, error, refresh } = useLiveQuery(fetchCarryForward);

  // Expand/collapse per client group (all expanded by default - same look as
  // before, now collapsible)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleGroup = (visitId: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(visitId)) next.delete(visitId); else next.add(visitId);
      return next;
    });

  // Planning actions
  const [removeTarget, setRemoveTarget] = useState<CarriedItem | null>(null);
  const [addTaskFor, setAddTaskFor] = useState<string | null>(null); // visitId
  const [addTaskId, setAddTaskId] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const [addBusy, setAddBusy] = useState(false);

  const handleRemove = async () => {
    if (!removeTarget) return;
    try {
      const res = await fetch(`/api/admin/carry-forward?subtaskId=${encodeURIComponent(removeTarget.id)}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(json?.error || "Failed to remove"); return; }
      toast.success("Carry-forward task removed");
      refresh();
    } catch {
      toast.error("Error removing task");
    } finally {
      setRemoveTarget(null);
    }
  };

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addTaskId || !addTitle.trim()) { toast.error("Select a main task and enter a title"); return; }
    setAddBusy(true);
    try {
      const res = await fetch("/api/admin/carry-forward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: addTaskId, title: addTitle.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(json?.error || "Failed to add task"); return; }
      toast.success("Task added to the next visit");
      setAddTitle("");
      setAddTaskFor(null);
      refresh();
    } catch {
      toast.error("Error adding task");
    } finally {
      setAddBusy(false);
    }
  };

  useEffect(() => {
    if (error) toast.error("Failed to load carry-forward data");
  }, [error]);

  const groups = data?.carryForwards ?? [];
  // Carry-forward exists at two levels (same convention as /api/admin/stats):
  //   1. Subtask-level: individual carried subtasks (carriedItems)
  //   2. Visit-level: a whole visit flagged as carry-forward with no carried
  //      subtasks of its own (e.g. "Missed Weekly Visit", reschedule carry) -
  //      these have a `reason` and count as 1 carry-forward each.
  // Counting only carriedItems made the page show 0 even when carry-forward
  // visits existed.
  const totalCarried = groups.reduce(
    (s, g) => s + (g.carriedItems.length > 0 ? g.carriedItems.length : g.reason ? 1 : 0),
    0
  );
  const completedCarried = groups.reduce(
    (s, g) =>
      s +
      (g.carriedItems.length > 0
        ? g.carriedItems.filter((i) => i.isCompleted).length
        : g.reason && g.visitStatus === "CLOSED" ? 1 : 0),
    0
  );

  if (loading && !data) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-[#0f1829]">Carry-Forward History</h1>
          <p className="text-[#8896a9] text-sm mt-1">
            Incomplete subtasks automatically carried to next visits
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#0f1829]">Carry-Forward History</h1>
        <p className="text-[#8896a9] text-sm mt-1">
          Incomplete subtasks and missed weekly visits automatically carried forward
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white border border-[#e2e7f0] rounded-2xl p-4 sm:p-5 flex sm:block items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center flex-shrink-0 sm:mb-3">
            <RotateCcw className="w-5 h-5 text-[#ff944d]" />
          </div>
          <div>
            <p className="text-sm text-[#8896a9]">Total Carried</p>
            <p className="text-2xl sm:text-3xl font-bold text-[#ff944d] mt-0 sm:mt-1">{totalCarried}</p>
          </div>
        </div>
        <div className="bg-white border border-[#e2e7f0] rounded-2xl p-4 sm:p-5 flex sm:block items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0 sm:mb-3">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-sm text-[#8896a9]">Resolved</p>
            <p className="text-2xl sm:text-3xl font-bold text-green-600 mt-0 sm:mt-1">{completedCarried}</p>
          </div>
        </div>
        <div className="bg-white border border-[#e2e7f0] rounded-2xl p-4 sm:p-5 flex sm:block items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-[#fff0f6] flex items-center justify-center flex-shrink-0 sm:mb-3">
            <XCircle className="w-5 h-5 text-[#800040]" />
          </div>
          <div>
            <p className="text-sm text-[#8896a9]">Still Pending</p>
            <p className="text-2xl sm:text-3xl font-bold text-[#800040] mt-0 sm:mt-1">{totalCarried - completedCarried}</p>
          </div>
        </div>
      </div>

      {/* Groups */}
      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 bg-white border border-[#e2e7f0] rounded-2xl text-[#8896a9]">
          <div className="w-12 h-12 rounded-xl bg-[#f1f4f9] flex items-center justify-center mb-3">
            <RotateCcw className="w-6 h-6 text-[#c8d2e0]" />
          </div>
          <p className="text-sm font-medium text-[#4a5568]">No carry-forward items found</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => {
            const isExpanded = !collapsed.has(group.visitId);
            const isEditable = group.visitStatus !== "CLOSED";
            return (
            <div key={group.visitId} className="bg-white border border-[#e2e7f0] rounded-2xl overflow-hidden shadow-sm">
              {/* Group header - Client name, expandable */}
              <button
                type="button"
                onClick={() => toggleGroup(group.visitId)}
                className="w-full flex items-center justify-between gap-2 px-3.5 sm:px-5 py-3.5 sm:py-4 border-b border-[#e2e7f0] bg-[#f8f9fc] text-left hover:bg-[#f1f4f9] transition-colors"
              >
                <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                  {isExpanded
                    ? <ChevronDown className="w-4 h-4 text-[#8896a9] flex-shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-[#8896a9] flex-shrink-0" />}
                  <div className="p-2 rounded-lg bg-orange-50 border border-orange-100 flex-shrink-0 hidden sm:block">
                    <RotateCcw className="w-4 h-4 text-[#ff944d]" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-[#0f1829] truncate">{group.clientName}</p>
                      <span className="text-xs text-[#8896a9] font-mono bg-[#f1f4f9] px-1.5 py-0.5 rounded">
                        {group.visitNumber}
                      </span>
                      {group.reason && (
                        <span className="text-[10px] font-bold text-[#ff944d] bg-orange-100 px-1.5 py-0.5 rounded-full">
                          {group.reason}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#8896a9]">
                      {group.executiveName} · Scheduled {formatDate(group.scheduledDate)}
                    </p>
                  </div>
                </div>
                <span className={cn(
                  "px-2 sm:px-2.5 py-1 rounded-full text-[10px] sm:text-xs font-semibold border flex-shrink-0 whitespace-nowrap",
                  group.visitStatus === "CLOSED"
                    ? "text-green-700 bg-green-50 border-green-200"
                    : group.visitStatus === "OPEN"
                    ? "text-blue-700 bg-blue-50 border-blue-200"
                    : "text-amber-700 bg-amber-50 border-amber-200"
                )}>
                  {group.visitStatus === "OPEN" ? "In Progress" : group.visitStatus.charAt(0) + group.visitStatus.slice(1).toLowerCase()}
                </span>
              </button>

              {/* Items (expandable) */}
              {isExpanded && (
                <>
                  {group.carriedItems.length === 0 ? (
                    <div className="px-5 py-3 text-xs text-[#8896a9]">
                      No individual carried subtasks — this visit was auto-created because the client
                      wasn&apos;t visited during its usual week.
                    </div>
                  ) : (
                    <div className="divide-y divide-[#f1f4f9]">
                      {group.carriedItems.map((item) => (
                        <div key={item.id} className="px-3.5 sm:px-5 py-3 flex items-start gap-2.5 sm:gap-4 flex-wrap sm:flex-nowrap hover:bg-[#f8f9fc] transition-colors">
                          {item.isCompleted ? (
                            <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                          ) : (
                            <XCircle className="w-4 h-4 text-[#800040] mt-0.5 flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0 basis-48">
                            <p className="text-sm text-[#0f1829] break-words">{item.title.replace("[CARRY-FORWARD] ", "")}</p>
                            <p className="text-xs text-[#8896a9] mt-0.5">{item.taskTitle}</p>
                            {item.sourceVisitNumber !== "N/A" && (
                              <div className="flex items-center gap-1 mt-1">
                                <span className="text-xs text-[#8896a9]">From</span>
                                <span className="text-xs text-[#ff944d] font-mono font-medium">
                                  {item.sourceVisitNumber}
                                </span>
                                {item.sourceClosedAt && (
                                  <span className="text-xs text-[#8896a9]">
                                    (closed {formatDate(item.sourceClosedAt)})
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          <span className={`text-xs font-semibold flex-shrink-0 px-2 py-0.5 rounded-full border ${
                            item.isCompleted
                              ? "text-green-700 bg-green-50 border-green-200"
                              : "text-[#800040] bg-[#fff0f6] border-[#ffadd1]"
                          }`}>
                            {item.isCompleted ? "Resolved" : "Pending"}
                          </span>
                          {isEditable && !item.isCompleted && (
                            <button
                              type="button"
                              onClick={() => setRemoveTarget(item)}
                              title="Remove this carry-forward task from the next visit"
                              className="p-1.5 rounded-lg bg-[#f1f4f9] hover:bg-red-50 text-[#8896a9] hover:text-red-600 transition-colors border border-[#e2e7f0] flex-shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Planning actions - this page plans the next visit */}
                  {isEditable && (
                    <div className="px-3.5 sm:px-5 py-3 border-t border-[#f1f4f9] bg-[#f8f9fc]/60">
                      {addTaskFor === group.visitId ? (
                        <form onSubmit={handleAddTask} className="flex flex-col sm:flex-row gap-2">
                          <select
                            value={addTaskId}
                            onChange={(e) => setAddTaskId(e.target.value)}
                            className="border border-[#e2e7f0] rounded-lg px-2.5 py-2 text-xs text-[#0f1829] bg-white focus:outline-none focus:ring-2 focus:ring-[#25488e]/30 sm:w-48"
                          >
                            <option value="">Select main task…</option>
                            {group.visitTasks.map((t) => (
                              <option key={t.id} value={t.id}>{t.title}</option>
                            ))}
                          </select>
                          <input
                            autoFocus
                            value={addTitle}
                            onChange={(e) => setAddTitle(e.target.value)}
                            placeholder="New task for the next visit…"
                            className="flex-1 border border-[#e2e7f0] rounded-lg px-3 py-2 text-xs text-[#0f1829] bg-white focus:outline-none focus:ring-2 focus:ring-[#25488e]/30"
                          />
                          <div className="flex gap-2">
                            <button
                              type="submit"
                              disabled={addBusy}
                              className="px-3 py-2 rounded-lg bg-[#25488e] hover:bg-[#1e3a72] disabled:opacity-50 text-white text-xs font-semibold transition-colors"
                            >
                              {addBusy ? "Adding…" : "Add"}
                            </button>
                            <button
                              type="button"
                              onClick={() => { setAddTaskFor(null); setAddTitle(""); }}
                              className="px-3 py-2 rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#4a5568] text-xs font-semibold transition-colors border border-[#e2e7f0]"
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => { setAddTaskFor(group.visitId); setAddTaskId(group.visitTasks[0]?.id ?? ""); setAddTitle(""); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#25488e] hover:bg-[#1e3a72] text-white text-xs font-semibold transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Add Task
                          </button>
                          <Link
                            href="/admin/task-config"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#4a5568] text-xs font-semibold transition-colors border border-[#e2e7f0]"
                          >
                            <Settings2 className="w-3.5 h-3.5" />
                            Task Configuration
                          </Link>
                          <span className="text-[11px] text-[#8896a9]">
                            Changes apply to visit {group.visitNumber} immediately.
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          );})}
        </div>
      )}

      {/* ── Remove carry-forward confirmation (in-app, no browser popups) ── */}
      <ConfirmDialog
        isOpen={!!removeTarget}
        title="Remove Carry-Forward Task"
        message={<>Remove <strong className="text-[#0f1829]">&quot;{removeTarget?.title.replace("[CARRY-FORWARD] ", "")}&quot;</strong> from the next visit? The executive will no longer see this task. The original visit history is not affected.</>}
        confirmLabel="Remove"
        danger
        onConfirm={handleRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}
