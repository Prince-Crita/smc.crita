"use client";

import { useEffect, useState, useCallback, useRef, memo, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  ArrowLeft, CheckCircle2, Circle, RotateCcw, Clock,
  ChevronDown, ChevronUp, Lock, XCircle, AlertCircle, X, TrendingUp,
  FileText, Calendar, User, CheckSquare, Save, RefreshCw, Info,
} from "lucide-react";
import { formatDate, formatDateTime, formatTimeAgo, getProgressColor, getRatingColor, cn } from "@/lib/utils/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Subtask {
  id: string;
  title: string;
  isCompleted: boolean;
  incompletionReason: string | null;
  isCarriedForward: boolean;
  completedAt: string | null;
}

interface Task {
  id: string;
  taskType: string;
  title: string;
  description: string;
  status: string;
  orderIndex: number;
  mdMeetingAnswer: "YES" | "NO" | null;
  subtasks: Subtask[];
}

interface ActivityLog {
  id: string;
  action: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  user: { name: string; role: string };
}

interface Visit {
  id: string;
  visitNumber: string;
  status: string;
  scheduledDate: string;
  openedAt: string | null;
  closedAt: string | null;
  summaryJson: Record<string, unknown> | null;
  notes: string | null;
  progress: number;
  totalSubtasks: number;
  completedSubtasks: number;
  client: { name: string; code: string; contactPerson: string; address: string; phone: string | null };
  executive: { name: string; email: string };
  tasks: Task[];
  activityLogs: ActivityLog[];
}

// ─── Subtask Item ─────────────────────────────────────────────────────────────

const SubtaskItem = memo(function SubtaskItem({
  subtask,
  isEditable,
  onToggle,
  onReasonChange,
}: {
  subtask: Subtask;
  isEditable: boolean;
  onToggle: (id: string) => void;
  onReasonChange: (id: string, reason: string) => void;
}) {
  const showReasonField = !subtask.isCompleted && isEditable;
  const showReasonDisplay = !subtask.isCompleted && !isEditable && subtask.incompletionReason;

  return (
    <div className={cn(
      "rounded-xl border transition-all duration-200",
      subtask.isCompleted
        ? "bg-emerald-500/5 border-emerald-500/20"
        : "bg-slate-800/40 border-slate-700/50",
      subtask.isCarriedForward && !subtask.isCompleted && "border-orange-500/30 bg-orange-500/5"
    )}>
      <div className="flex items-start gap-3 p-3">
        <button
          type="button"
          onClick={() => isEditable && onToggle(subtask.id)}
          disabled={!isEditable}
          className={cn(
            "mt-0.5 flex-shrink-0 rounded-full transition-all duration-150",
            isEditable ? "hover:scale-110 active:scale-95" : "opacity-60 cursor-not-allowed"
          )}
          aria-label={subtask.isCompleted ? "Mark incomplete" : "Mark complete"}
        >
          {subtask.isCompleted ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          ) : (
            <Circle className="w-5 h-5 text-slate-600" />
          )}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={cn(
              "text-sm leading-snug",
              subtask.isCompleted
                ? "text-emerald-300 line-through decoration-emerald-500/50"
                : "text-white"
            )}>
              {subtask.title.replace("[CARRY-FORWARD] ", "")}
            </p>
            {subtask.isCarriedForward && (
              <span className="flex items-center gap-1 text-xs text-orange-400 bg-orange-400/10 border border-orange-400/20 px-1.5 py-0.5 rounded-full flex-shrink-0">
                <RotateCcw className="w-2.5 h-2.5" />
                Carried
              </span>
            )}
          </div>

          {showReasonField && (
            <div className="mt-2">
              <input
                type="text"
                placeholder="Reason for not completing (required before closing)"
                value={subtask.incompletionReason || ""}
                onChange={(e) => onReasonChange(subtask.id, e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all"
              />
            </div>
          )}

          {showReasonDisplay && (
            <p className="mt-1 text-xs text-amber-400/70 italic pl-0.5">
              Reason: {subtask.incompletionReason}
            </p>
          )}
        </div>
      </div>
    </div>
  );
});

// ─── Task Card ────────────────────────────────────────────────────────────────

const TaskCard = memo(function TaskCard({
  task,
  isEditable,
  onSave,
}: {
  task: Task;
  isEditable: boolean;
  onSave: (taskId: string, subtasks: Subtask[], mdMeetingAnswer?: string) => Promise<void>;
}) {
  const [isExpanded, setIsExpanded] = useState(task.status !== "PENDING");
  const [localSubtasks, setLocalSubtasks] = useState<Subtask[]>(task.subtasks);
  const [mdAnswer, setMdAnswer] = useState<"YES" | "NO" | "">(task.mdMeetingAnswer || "");
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync when parent refreshes
  const prevTaskRef = useRef(task);
  useEffect(() => {
    // Only sync from parent if we have no dirty local changes
    if (!isDirty) {
      setLocalSubtasks(task.subtasks);
      setMdAnswer(task.mdMeetingAnswer || "");
    }
    prevTaskRef.current = task;
  }, [task, isDirty]);

  const completedCount = localSubtasks.filter((s) => s.isCompleted).length;
  const totalCount = localSubtasks.length;
  const taskProgress = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);
  const isMdMeeting = task.taskType === "MD_MEETING";

  const handleToggle = (id: string) => {
    setLocalSubtasks((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              isCompleted: !s.isCompleted,
              // When marking complete, clear reason; when marking incomplete, keep existing reason
              incompletionReason: !s.isCompleted ? null : s.incompletionReason,
            }
          : s
      )
    );
    setIsDirty(true);
    setSaveError(null);
  };

  const handleReasonChange = (id: string, reason: string) => {
    setLocalSubtasks((prev) =>
      prev.map((s) => (s.id === id ? { ...s, incompletionReason: reason } : s))
    );
    setIsDirty(true);
  };

  const handleSave = async () => {
    // Frontend guard: MD Meeting requires selection
    if (isMdMeeting && !mdAnswer) {
      toast.error("Please select YES or NO for MD Meeting before saving");
      return;
    }

    setSaveError(null);
    setIsSaving(true);
    try {
      await onSave(
        task.id,
        localSubtasks,
        mdAnswer || undefined
      );
      setIsDirty(false);
      toast.success("Progress saved ✓");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      setSaveError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const statusColor =
    taskProgress === 100
      ? "text-emerald-400"
      : taskProgress > 0
      ? "text-blue-400"
      : "text-slate-500";

  return (
    <div className={cn(
      "bg-slate-900 border rounded-2xl overflow-hidden transition-all duration-200",
      taskProgress === 100
        ? "border-emerald-500/30 shadow-sm shadow-emerald-500/5"
        : isDirty
        ? "border-amber-500/30"
        : "border-slate-800"
    )}>
      {/* Task header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-slate-800/40 transition-colors text-left"
      >
        <div className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 transition-all",
          taskProgress === 100
            ? "bg-emerald-500/20 text-emerald-400"
            : taskProgress > 0
            ? "bg-blue-500/20 text-blue-400"
            : "bg-slate-800 text-slate-500"
        )}>
          {taskProgress === 100 ? "✓" : task.orderIndex}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-white">{task.title}</p>
            {isDirty && (
              <span className="text-xs text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded-full border border-amber-400/20">
                unsaved
              </span>
            )}
            {isMdMeeting && mdAnswer && (
              <span className={cn(
                "text-xs px-2 py-0.5 rounded-full border",
                mdAnswer === "YES"
                  ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/20"
                  : "text-red-400 bg-red-400/10 border-red-400/20"
              )}>
                MD: {mdAnswer}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1">
            <div className="w-20 h-1 bg-slate-800 rounded-full">
              <div
                className={cn("h-full rounded-full transition-all duration-300", getProgressColor(taskProgress))}
                style={{ width: `${taskProgress}%` }}
              />
            </div>
            <span className={cn("text-xs font-medium", statusColor)}>
              {completedCount}/{totalCount}
            </span>
          </div>
        </div>

        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-slate-600 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-600 flex-shrink-0" />
        )}
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-800/80 pt-3">
          {task.description && (
            <p className="text-xs text-slate-500 leading-relaxed">{task.description}</p>
          )}

          {/* MD Meeting Answer */}
          {isMdMeeting && isEditable && (
            <div className="p-3 rounded-xl bg-blue-600/5 border border-blue-500/20">
              <p className="text-xs font-semibold text-blue-300 mb-2 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5" />
                MD Meeting Confirmation (Required)
              </p>
              <div className="flex gap-2">
                {(["YES", "NO"] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      setMdAnswer(opt);
                      setIsDirty(true);
                    }}
                    disabled={!isEditable}
                    className={cn(
                      "flex-1 py-2 rounded-lg text-sm font-semibold border transition-all",
                      mdAnswer === opt
                        ? opt === "YES"
                          ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                          : "bg-red-500/20 text-red-400 border-red-500/40"
                        : "bg-slate-800 text-slate-500 border-slate-700 hover:border-slate-600 hover:text-slate-300"
                    )}
                  >
                    {opt === "YES" ? "✓ YES" : "✗ NO"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isMdMeeting && !isEditable && task.mdMeetingAnswer && (
            <div className={cn(
              "p-3 rounded-xl border",
              task.mdMeetingAnswer === "YES"
                ? "bg-emerald-500/5 border-emerald-500/20"
                : "bg-red-500/5 border-red-500/20"
            )}>
              <p className="text-xs text-slate-500">MD Meeting Result</p>
              <p className={cn("text-sm font-bold mt-0.5", task.mdMeetingAnswer === "YES" ? "text-emerald-400" : "text-red-400")}>
                {task.mdMeetingAnswer === "YES" ? "✓ Meeting Held" : "✗ Not Conducted"}
              </p>
            </div>
          )}

          {/* Subtasks */}
          <div className="space-y-2">
            {localSubtasks.map((subtask) => (
              <SubtaskItem
                key={subtask.id}
                subtask={subtask}
                isEditable={isEditable}
                onToggle={handleToggle}
                onReasonChange={handleReasonChange}
              />
            ))}
          </div>

          {/* Save error */}
          {saveError && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-400">{saveError}</p>
            </div>
          )}

          {/* Save button — always show when editable and dirty */}
          {isEditable && isDirty && (
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:bg-blue-600/50 text-white text-sm font-semibold rounded-xl transition-all flex items-center justify-center gap-2 shadow-sm"
            >
              {isSaving ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  Save Progress
                </>
              )}
            </button>
          )}

          {/* Saved state indicator */}
          {isEditable && !isDirty && completedCount > 0 && (
            <p className="text-xs text-center text-emerald-400/70 flex items-center justify-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              Progress saved
            </p>
          )}
        </div>
      )}
    </div>
  );
});

// ─── Activity Timeline ────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  VISIT_CREATED: "Visit created",
  VISIT_OPENED: "Visit opened",
  VISIT_CLOSED: "Visit closed",
  TASK_STARTED: "Task progress saved",
  TASK_COMPLETED: "Task completed",
  SUBTASK_COMPLETED: "Subtask completed",
  CARRY_FORWARD_APPLIED: "Carry-forward applied",
  SUMMARY_GENERATED: "Summary generated",
};

const ACTION_COLORS: Record<string, string> = {
  VISIT_OPENED: "bg-blue-500",
  VISIT_CLOSED: "bg-emerald-500",
  TASK_COMPLETED: "bg-cyan-500",
  TASK_STARTED: "bg-blue-400",
  CARRY_FORWARD_APPLIED: "bg-orange-500",
  SUMMARY_GENERATED: "bg-purple-500",
};

function ActivityTimeline({ logs }: { logs: ActivityLog[] }) {
  if (logs.length === 0) {
    return <p className="text-sm text-slate-600 text-center py-4">No activity yet</p>;
  }

  return (
    <div className="space-y-0">
      {logs.map((log, idx) => (
        <div key={log.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className={cn(
              "w-2 h-2 rounded-full mt-1.5 flex-shrink-0",
              ACTION_COLORS[log.action] || "bg-slate-600"
            )} />
            {idx < logs.length - 1 && <div className="w-px flex-1 bg-slate-800 mt-1" />}
          </div>
          <div className="pb-3 flex-1 min-w-0">
            <p className="text-sm text-white">{ACTION_LABELS[log.action] || log.action}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {log.user.name} · {formatTimeAgo(log.createdAt)}
            </p>
            {log.action === "CARRY_FORWARD_APPLIED" && log.metadata?.carriedCount != null && (
              <p className="text-xs text-orange-400 mt-0.5">
                {String(log.metadata.carriedCount)} item(s) carried to next visit
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Visit Summary Modal ──────────────────────────────────────────────────────

function VisitSummaryModal({
  summary,
  onClose,
}: {
  summary: Record<string, unknown>;
  onClose: () => void;
}) {
  const s = summary as {
    visitNumber: string;
    clientName: string;
    executiveName: string;
    completionPercentage: number;
    mdMeetingHeld: boolean;
    mdMeetingAnswer: string;
    overallRating: string;
    totalTasks: number;
    completedTasks: number;
    carryForwardCount: number;
    duration: string;
    keyFindings: string[];
    taskBreakdown: {
      title: string;
      completedSubtasks: number;
      totalSubtasks: number;
      incompleteItems: { title: string; reason: string }[];
    }[];
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[92vh] sm:max-h-[88vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-gradient-to-r from-blue-600/10 to-transparent flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <FileText className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <p className="text-base font-bold text-white">Visit Summary</p>
              <p className="text-xs text-slate-500">{s.visitNumber} · {s.clientName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {/* Score row */}
          <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl border border-slate-700">
            <div>
              <p className="text-xs text-slate-500">Overall Rating</p>
              <p className={cn("text-2xl font-bold mt-0.5", getRatingColor(s.overallRating))}>
                {s.overallRating}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-500">Completion</p>
              <p className="text-2xl font-bold text-white mt-0.5">{s.completionPercentage}%</p>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Tasks Done", value: `${s.completedTasks}/${s.totalTasks}`, color: "text-white" },
              { label: "MD Meeting", value: s.mdMeetingAnswer || "N/A", color: s.mdMeetingHeld ? "text-emerald-400" : "text-red-400" },
              { label: "Carry-Fwd", value: s.carryForwardCount, color: s.carryForwardCount > 0 ? "text-orange-400" : "text-emerald-400" },
              { label: "Duration", value: s.duration, color: "text-blue-400" },
            ].map((item) => (
              <div key={item.label} className="p-3 bg-slate-800/40 rounded-xl text-center border border-slate-700/50">
                <p className="text-xs text-slate-500 mb-1">{item.label}</p>
                <p className={cn("text-lg font-bold", item.color)}>{String(item.value)}</p>
              </div>
            ))}
          </div>

          {/* Task breakdown */}
          <div>
            <p className="text-sm font-semibold text-white mb-3">Task Breakdown</p>
            <div className="space-y-2">
              {s.taskBreakdown?.map((task) => {
                const pct = task.totalSubtasks === 0
                  ? 0
                  : Math.round((task.completedSubtasks / task.totalSubtasks) * 100);
                return (
                  <div key={task.title} className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/50">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-sm text-white">{task.title}</p>
                      <span className="text-xs text-slate-400">{task.completedSubtasks}/{task.totalSubtasks}</span>
                    </div>
                    <div className="h-1.5 bg-slate-700 rounded-full">
                      <div
                        className={cn("h-full rounded-full", getProgressColor(pct))}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {task.incompleteItems?.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {task.incompleteItems.map((item, i) => (
                          <p key={i} className="text-xs text-amber-400/80">• {item.title}: {item.reason}</p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Key findings */}
          {s.keyFindings?.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-white mb-3">Key Findings</p>
              <div className="space-y-2">
                {s.keyFindings.map((finding, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-slate-300">
                    <span className="text-blue-400 mt-0.5 flex-shrink-0">›</span>
                    <p>{finding}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Close Visit Modal ────────────────────────────────────────────────────────

function CloseVisitModal({
  isClosing,
  validationErrors,
  closeNotes,
  onNotesChange,
  onClose,
  onConfirm,
}: {
  isClosing: boolean;
  validationErrors: string[];
  closeNotes: string;
  onNotesChange: (v: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-emerald-400" />
            <p className="font-semibold text-white">Close Visit</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {validationErrors.length > 0 && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl space-y-1.5">
              <p className="text-xs font-semibold text-red-400 mb-1 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5" />
                Please resolve before closing
              </p>
              {validationErrors.map((err, i) => (
                <p key={i} className="text-xs text-red-400/80">• {err}</p>
              ))}
            </div>
          )}

          {validationErrors.length === 0 && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-slate-300">
                All checks passed. This will close the visit, carry forward any incomplete items, and email a summary.
              </p>
            </div>
          )}

          <div>
            <label className="text-xs text-slate-500 mb-1.5 block font-medium">
              Additional Notes <span className="text-slate-600">(optional)</span>
            </label>
            <textarea
              value={closeNotes}
              onChange={(e) => onNotesChange(e.target.value)}
              placeholder="Final observations or remarks..."
              rows={3}
              className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/50 resize-none transition-all"
            />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-sm font-medium rounded-xl transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isClosing || validationErrors.length > 0}
              id="confirm-close-btn"
              className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all flex items-center justify-center gap-2"
            >
              {isClosing ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Closing...
                </>
              ) : (
                <>
                  <Lock className="w-3.5 h-3.5" />
                  Confirm Close
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function VisitDetailPage() {
  const params = useParams();
  const router = useRouter();
  const visitId = params.visitId as string;

  const [visit, setVisit] = useState<Visit | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpening, setIsOpening] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [closeNotes, setCloseNotes] = useState("");
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchVisit = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    else setIsRefreshing(true);
    try {
      const res = await fetch(`/api/visits/${visitId}`);
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setVisit(data.visit);
    } catch {
      if (!silent) toast.error("Failed to load visit");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [visitId]);

  useEffect(() => {
    fetchVisit();
  }, [fetchVisit]);

  const handleOpenVisit = async () => {
    setIsOpening(true);
    try {
      const res = await fetch(`/api/visits/${visitId}`, { method: "PATCH" });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed");
      }
      toast.success("Visit opened!");
      await fetchVisit(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to open visit");
    } finally {
      setIsOpening(false);
    }
  };

  // Called by TaskCard — no reason enforcement here, that's only at close.
  // OPTIMISTIC UPDATE: Instead of re-fetching the entire visit (50 activity
  // logs + all tasks + client data), we patch only the changed task in local
  // state using the updatedTask returned in the API response. This makes
  // task saves feel instant without a network round-trip for the refetch.
  const handleSaveTask = async (taskId: string, subtasks: Subtask[], mdMeetingAnswer?: string) => {
    const res = await fetch(`/api/tasks/${taskId}/complete`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subtasks: subtasks.map((s) => ({
          id: s.id,
          isCompleted: s.isCompleted,
          incompletionReason: s.incompletionReason ?? null,
        })),
        mdMeetingAnswer: mdMeetingAnswer || null,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Save failed");
    }

    const data = await res.json();

    // Patch only the changed task in local visit state — no refetch needed.
    // The API returns the fully updated task (with subtasks) so we can
    // replace just that one task and recalculate progress locally.
    setVisit((prev) => {
      if (!prev) return prev;
      const updatedTasks = prev.tasks.map((t) =>
        t.id === taskId ? { ...t, ...data.task } : t
      );
      const totalSubtasks = updatedTasks.reduce((s, t) => s + t.subtasks.length, 0);
      const completedSubtasks = updatedTasks.reduce(
        (s, t) => s + t.subtasks.filter((st: Subtask) => st.isCompleted).length,
        0
      );
      const progress = totalSubtasks === 0 ? 0 : Math.round((completedSubtasks / totalSubtasks) * 100);
      return { ...prev, tasks: updatedTasks, progress, totalSubtasks, completedSubtasks };
    });
  };

  const handleAttemptClose = async () => {
    // Validate client-side first using fresh DB data
    setIsClosing(true);
    setValidationErrors([]);
    try {
      const res = await fetch(`/api/visits/${visitId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: closeNotes }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.validationErrors) {
          setValidationErrors(data.validationErrors);
          toast.error("Please resolve issues before closing");
        } else {
          toast.error(data.error || "Failed to close visit");
          setShowCloseConfirm(false);
        }
        return;
      }

      toast.success("Visit closed successfully!");
      setShowCloseConfirm(false);
      await fetchVisit(true);
      setShowSummary(true);
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setIsClosing(false);
    }
  };

  // ─── Loading / error states ───────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-4xl">
        <div className="h-8 w-32 bg-slate-800 animate-pulse rounded-lg" />
        <div className="h-40 bg-slate-900 border border-slate-800 animate-pulse rounded-2xl" />
        <div className="h-16 bg-slate-900 border border-slate-800 animate-pulse rounded-2xl" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 bg-slate-900 border border-slate-800 animate-pulse rounded-2xl" />
            ))}
          </div>
          <div className="h-40 bg-slate-900 border border-slate-800 animate-pulse rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!visit) {
    return (
      <div className="text-center py-16 text-slate-500">
        <XCircle className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p className="font-medium">Visit not found</p>
        <button onClick={() => router.push("/executive/visits")} className="mt-3 text-sm text-blue-400 hover:underline">
          ← Back to Visits
        </button>
      </div>
    );
  }

  const isEditable = visit.status === "OPEN";

  return (
    <div className="space-y-4 max-w-4xl">
      {/* Back button */}
      <button
        type="button"
        onClick={() => router.push("/executive/visits")}
        className="flex items-center gap-2 text-slate-500 hover:text-white text-sm transition-colors group"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        Back to Visits
      </button>

      {/* ── Visit header card ──────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-xs font-mono text-slate-500">{visit.visitNumber}</span>
              <span className={cn(
                "px-2 py-0.5 rounded-full text-xs font-medium border",
                visit.status === "OPEN"
                  ? "text-blue-400 bg-blue-400/10 border-blue-400/20"
                  : visit.status === "CLOSED"
                  ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/20"
                  : "text-amber-400 bg-amber-400/10 border-amber-400/20"
              )}>
                {visit.status === "OPEN" ? "In Progress" : visit.status === "PENDING" ? "Pending" : "Closed"}
              </span>
              {isRefreshing && (
                <RefreshCw className="w-3.5 h-3.5 text-slate-600 animate-spin" />
              )}
            </div>
            <h1 className="text-xl font-bold text-white">{visit.client.name}</h1>
            <p className="text-sm text-slate-400 mt-0.5">{visit.client.contactPerson} · {visit.client.address}</p>
            {visit.client.phone && (
              <p className="text-xs text-slate-500 mt-0.5">{visit.client.phone}</p>
            )}
          </div>

          <div className="flex gap-2 flex-wrap sm:flex-nowrap sm:flex-col sm:items-end">
            {visit.status === "PENDING" && (
              <button
                type="button"
                onClick={handleOpenVisit}
                disabled={isOpening}
                id="open-visit-btn"
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-all flex items-center gap-2 shadow-sm"
              >
                {isOpening ? (
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <CheckSquare className="w-4 h-4" />
                )}
                Open Visit
              </button>
            )}

            {visit.status === "OPEN" && (
              <button
                type="button"
                onClick={() => {
                  setValidationErrors([]);
                  setShowCloseConfirm(true);
                }}
                id="close-visit-btn"
                className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-sm font-semibold rounded-xl transition-all flex items-center gap-2 shadow-sm"
              >
                <Lock className="w-4 h-4" />
                Close Visit
              </button>
            )}

            {visit.status === "CLOSED" && (
              <button
                type="button"
                onClick={() => setShowSummary(true)}
                className="px-4 py-2.5 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 text-purple-400 text-sm font-semibold rounded-xl transition-all flex items-center gap-2"
              >
                <FileText className="w-4 h-4" />
                View Summary
              </button>
            )}
          </div>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-slate-800 text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            Scheduled: <span className="text-slate-300 ml-0.5">{formatDate(visit.scheduledDate)}</span>
          </div>
          {visit.openedAt && (
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              Opened: <span className="text-slate-300 ml-0.5">{formatDateTime(visit.openedAt)}</span>
            </div>
          )}
          {visit.closedAt && (
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              Closed: <span className="text-emerald-400 ml-0.5">{formatDateTime(visit.closedAt)}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <User className="w-3.5 h-3.5" />
            <span className="text-slate-300">{visit.executive.name}</span>
          </div>
        </div>
      </div>

      {/* ── Progress tracker ───────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-blue-400" />
            Overall Progress
          </h2>
          <span className="text-2xl font-bold text-white">{visit.progress}%</span>
        </div>
        <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-500", getProgressColor(visit.progress))}
            style={{ width: `${visit.progress}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-2 text-xs text-slate-500">
          <span>{visit.completedSubtasks} of {visit.totalSubtasks} subtasks</span>
          <span className={cn(
            "font-medium",
            visit.progress === 100 ? "text-emerald-400" : visit.progress >= 50 ? "text-blue-400" : "text-amber-400"
          )}>
            {visit.progress === 100 ? "✓ All complete" : visit.progress >= 50 ? "Halfway there" : "In progress"}
          </span>
        </div>

        {/* Task dots */}
        <div className="flex items-center gap-2 mt-4 flex-wrap">
          {visit.tasks.map((task) => {
            const comp = task.subtasks.filter((s) => s.isCompleted).length;
            const tot = task.subtasks.length;
            const pct = tot === 0 ? 0 : Math.round((comp / tot) * 100);
            return (
              <div key={task.id} className="flex flex-col items-center gap-1">
                <div className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all",
                  pct === 100
                    ? "bg-emerald-500/20 border-emerald-500 text-emerald-400"
                    : pct > 0
                    ? "bg-blue-500/20 border-blue-500 text-blue-400"
                    : "bg-slate-800 border-slate-700 text-slate-600"
                )}>
                  {pct === 100 ? "✓" : task.orderIndex}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Incomplete subtasks hint (editable visit) ─────────────── */}
      {isEditable && (() => {
        const incomplete = visit.tasks.flatMap((t) =>
          t.subtasks.filter((s) => !s.isCompleted)
        ).length;
        const noReason = visit.tasks.flatMap((t) =>
          t.subtasks.filter((s) => !s.isCompleted && !s.incompletionReason?.trim())
        ).length;
        if (noReason === 0 && incomplete > 0) return null;
        if (noReason > 0) return (
          <div className="flex items-start gap-2 p-3.5 rounded-2xl bg-amber-500/5 border border-amber-500/20">
            <Info className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-400/90">
              <span className="font-medium">{noReason} subtask{noReason > 1 ? "s" : ""}</span> need a reason before you can close the visit.
            </p>
          </div>
        );
        return null;
      })()}

      {/* ── Tasks + Activity ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Tasks column */}
        <div className="lg:col-span-2 space-y-3">
          <h2 className="text-base font-semibold text-white">
            Tasks <span className="text-slate-600 font-normal text-sm">({visit.tasks.length})</span>
          </h2>
          {visit.tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              isEditable={isEditable}
              onSave={handleSaveTask}
            />
          ))}
        </div>

        {/* Activity sidebar */}
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-white">Activity</h2>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <ActivityTimeline logs={visit.activityLogs} />
          </div>
        </div>
      </div>

      {/* ── Modals ───────────────────────────────────────────────── */}
      {showCloseConfirm && (
        <CloseVisitModal
          isClosing={isClosing}
          validationErrors={validationErrors}
          closeNotes={closeNotes}
          onNotesChange={setCloseNotes}
          onClose={() => {
            setShowCloseConfirm(false);
            setValidationErrors([]);
          }}
          onConfirm={handleAttemptClose}
        />
      )}

      {showSummary && visit.summaryJson && (
        <VisitSummaryModal
          summary={visit.summaryJson}
          onClose={() => setShowSummary(false)}
        />
      )}
    </div>
  );
}
