"use client";

import { useEffect, useState, useCallback, useRef, memo, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  ArrowLeft, CheckCircle2, Circle, RotateCcw, Clock, Users,
  ChevronDown, ChevronUp, Lock, XCircle, AlertCircle, TrendingUp,
  FileText, Calendar, User, CheckSquare, Save, RefreshCw, Info,
} from "lucide-react";
import { formatDate, formatDateTime, formatTimeAgo, getProgressColor, getRatingColor, cn } from "@/lib/utils/utils";
import { useLiveQuery, fetchJSON } from "@/lib/hooks/useLiveQuery";
import { Modal } from "@/components/ui/Modal";

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
  endDate?: string | null;
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
  // Team visits: the API decides who may close, so the button follows
  // `canClose` rather than any client-side guess.
  isTeamVisit?: boolean;
  canClose?: boolean;
  teamLead?: { id: string; name: string };
  teamMembers?: { id: string; name: string }[];
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
        ? "bg-green-50 border-green-200"
        : "bg-white border-[#e2e7f0]",
      subtask.isCarriedForward && !subtask.isCompleted && "border-orange-200 bg-orange-50"
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
            <CheckCircle2 className="w-5 h-5 text-green-500" />
          ) : (
            <Circle className="w-5 h-5 text-[#c8d2e0]" />
          )}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={cn(
              "text-sm leading-snug",
              subtask.isCompleted
                ? "text-green-700 line-through decoration-green-400/50"
                : "text-[#0f1829]"
            )}>
              {subtask.title.replace("[CARRY-FORWARD] ", "")}
            </p>
            {subtask.isCarriedForward && (
              <span className="flex items-center gap-1 text-xs text-orange-600 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded-full flex-shrink-0">
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
                className="w-full px-3 py-1.5 bg-[#f8f9fc] border border-[#e2e7f0] rounded-lg text-xs text-[#0f1829] placeholder-[#8896a9] focus:outline-none focus:ring-1 focus:ring-amber-500/50 focus:border-amber-400 transition-all"
              />
            </div>
          )}

          {showReasonDisplay && (
            <p className="mt-1 text-xs text-amber-600 italic pl-0.5">
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
  // MR Monthly Report has a REQUIRED "Completed" (Yes/No) answer, stored in
  // the same per-task answer column as the MD Meeting confirmation. The visit
  // cannot be closed until it is answered (enforced server-side too).
  const isMrReport = task.taskType === "MR_MONTHLY_REPORT";
  const needsAnswer = isMdMeeting || isMrReport;

  // Derive a text-color class from completion progress — used in the count label
  const statusColor =
    taskProgress === 100 ? "text-green-600" :
    taskProgress > 0    ? "text-[#25488e]"  :
                          "text-[#8896a9]";


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
    // Frontend guard: MD Meeting / MR Monthly Report require a selection
    if (isMdMeeting && !mdAnswer) {
      toast.error("Please select YES or NO for MD Meeting before saving");
      return;
    }
    if (isMrReport && !mdAnswer) {
      toast.error("Please answer the \"Completed\" field (Yes/No) for MR Monthly Report before saving");
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

  return (
    <div className={cn(
      "bg-white border rounded-xl overflow-hidden transition-all duration-200",
      taskProgress === 100
        ? "border-green-200 shadow-sm"
        : isDirty
        ? "border-amber-300"
        : "border-[#e2e7f0]"
    )}>
      {/* Task header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-[#f8f9fc] transition-colors text-left"
      >
        <div className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 transition-all",
          taskProgress === 100
            ? "bg-green-100 text-green-600"
            : taskProgress > 0
            ? "bg-blue-50 text-[#25488e]"
            : "bg-[#f1f4f9] text-[#8896a9]"
        )}>
          {taskProgress === 100 ? "✓" : task.orderIndex}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-[#0f1829]">{task.title}</p>
            {isDirty && (
              <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-200">
                unsaved
              </span>
            )}
            {needsAnswer && mdAnswer && (
              <span className={cn(
                "text-xs px-2 py-0.5 rounded-full border",
                mdAnswer === "YES"
                  ? "text-green-700 bg-green-50 border-green-200"
                  : "text-red-700 bg-red-50 border-red-200"
              )}>
                {isMdMeeting ? "MD" : "Completed"}: {mdAnswer}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1">
            <div className="w-20 h-1.5 bg-[#f1f4f9] rounded-full">
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
          <ChevronUp className="w-4 h-4 text-[#8896a9] flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-[#8896a9] flex-shrink-0" />
        )}
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-[#e2e7f0] pt-3">
          {task.description && (
            <p className="text-xs text-[#8896a9] leading-relaxed">{task.description}</p>
          )}

          {/* MD Meeting / MR Monthly Report required Yes-No answer */}
          {needsAnswer && isEditable && (
            <div className="p-3 rounded-xl bg-blue-50 border border-blue-200">
              <p className="text-xs font-semibold text-[#25488e] mb-2 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5" />
                {isMdMeeting ? "MD Meeting Confirmation (Required)" : "Completed? (Required)"}
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
                          ? "bg-green-100 text-green-700 border-green-300"
                          : "bg-red-100 text-red-700 border-red-300"
                        : "bg-[#f8f9fc] text-[#8896a9] border-[#e2e7f0] hover:border-[#c8d2e0] hover:text-[#4a5568]"
                    )}
                  >
                    {opt === "YES" ? "✓ YES" : "✗ NO"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {needsAnswer && !isEditable && task.mdMeetingAnswer && (
            <div className={cn(
              "p-3 rounded-xl border",
              task.mdMeetingAnswer === "YES"
                ? "bg-green-50 border-green-200"
                : "bg-red-50 border-red-200"
            )}>
              <p className="text-xs text-[#8896a9]">{isMdMeeting ? "MD Meeting Result" : "MR Monthly Report Completed"}</p>
              <p className={cn("text-sm font-bold mt-0.5", task.mdMeetingAnswer === "YES" ? "text-green-700" : "text-red-700")}>
                {isMdMeeting
                  ? (task.mdMeetingAnswer === "YES" ? "✓ Meeting Held" : "✗ Not Conducted")
                  : (task.mdMeetingAnswer === "YES" ? "✓ Yes" : "✗ No")}
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
            <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-600">{saveError}</p>
            </div>
          )}

          {/* Save button — always show when editable and dirty */}
          {isEditable && isDirty && (
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="w-full py-2.5 bg-[#25488e] hover:bg-[#1e3a72] active:bg-[#162d5c] disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all flex items-center justify-center gap-2 shadow-sm press-effect"
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
            <p className="text-xs text-center text-green-600 flex items-center justify-center gap-1">
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
    return <p className="text-sm text-[#8896a9] text-center py-4">No activity yet</p>;
  }

  return (
    <div className="space-y-0">
      {logs.map((log, idx) => (
        <div key={log.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className={cn(
              "w-2 h-2 rounded-full mt-1.5 flex-shrink-0",
              ACTION_COLORS[log.action] || "bg-[#c8d2e0]"
            )} />
            {idx < logs.length - 1 && <div className="w-px flex-1 bg-[#f1f4f9] mt-1" />}
          </div>
          <div className="pb-3 flex-1 min-w-0">
            <p className="text-sm text-[#0f1829]">{ACTION_LABELS[log.action] || log.action}</p>
            <p className="text-xs text-[#8896a9] mt-0.5">
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
    <Modal isOpen title="Visit Summary" onClose={onClose} size="lg" overlayClassName="pb-16 sm:pb-0">
      <div className="p-5 space-y-5">
          {/* Visit identity */}
          <div className="flex items-center gap-3 -mt-1">
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
              <FileText className="w-4 h-4 text-[#25488e]" />
            </div>
            <p className="text-xs text-[#8896a9]">{s.visitNumber} · {s.clientName}</p>
          </div>

          {/* Score row */}
          <div className="flex items-center justify-between p-4 bg-[#f8f9fc] rounded-xl border border-[#e2e7f0]">
            <div>
              <p className="text-xs text-[#8896a9]">Overall Rating</p>
              <p className={cn("text-2xl font-bold mt-0.5", getRatingColor(s.overallRating))}>
                {s.overallRating}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-[#8896a9]">Completion</p>
              <p className="text-2xl font-bold text-[#0f1829] mt-0.5">{s.completionPercentage}%</p>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Tasks Done", value: `${s.completedTasks}/${s.totalTasks}`, color: "text-[#0f1829]" },
              { label: "MD Meeting", value: s.mdMeetingAnswer || "N/A", color: s.mdMeetingHeld ? "text-green-600" : "text-red-600" },
              { label: "Carry-Fwd", value: s.carryForwardCount, color: s.carryForwardCount > 0 ? "text-orange-600" : "text-green-600" },
              { label: "Duration", value: s.duration, color: "text-[#25488e]" },
            ].map((item) => (
              <div key={item.label} className="p-3 bg-[#f8f9fc] rounded-xl text-center border border-[#e2e7f0]">
                <p className="text-xs text-[#8896a9] mb-1">{item.label}</p>
                <p className={cn("text-lg font-bold", item.color)}>{String(item.value)}</p>
              </div>
            ))}
          </div>

          {/* Task breakdown */}
          <div>
            <p className="text-sm font-semibold text-[#0f1829] mb-3">Task Breakdown</p>
            <div className="space-y-2">
              {s.taskBreakdown?.map((task) => {
                const pct = task.totalSubtasks === 0
                  ? 0
                  : Math.round((task.completedSubtasks / task.totalSubtasks) * 100);
                return (
                  <div key={task.title} className="p-3 rounded-xl bg-[#f8f9fc] border border-[#e2e7f0]">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-sm text-[#0f1829]">{task.title}</p>
                      <span className="text-xs text-[#8896a9]">{task.completedSubtasks}/{task.totalSubtasks}</span>
                    </div>
                    <div className="h-1.5 bg-[#f1f4f9] rounded-full">
                      <div
                        className={cn("h-full rounded-full", getProgressColor(pct))}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {task.incompleteItems?.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {task.incompleteItems.map((item, i) => (
                          <p key={i} className="text-xs text-amber-600">• {item.title}: {item.reason}</p>
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
              <p className="text-sm font-semibold text-[#0f1829] mb-3">Key Findings</p>
              <div className="space-y-2">
                {s.keyFindings.map((finding, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-[#4a5568]">
                    <span className="text-[#25488e] mt-0.5 flex-shrink-0">›</span>
                    <p>{finding}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
      </div>
    </Modal>
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
    <Modal isOpen title="Close Visit" onClose={onClose} size="sm" overlayClassName="pb-16 sm:pb-0">
        <div className="p-5 space-y-4">
          {validationErrors.length > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl space-y-1.5">
              <p className="text-xs font-semibold text-red-600 mb-1 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5" />
                Please resolve before closing
              </p>
              {validationErrors.map((err, i) => (
                <p key={i} className="text-xs text-red-500">• {err}</p>
              ))}
            </div>
          )}

          {validationErrors.length === 0 && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-green-50 border border-green-200">
              <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-[#4a5568]">
                All checks passed. This will close the visit, carry forward any incomplete items, and email a summary.
              </p>
            </div>
          )}

          <div>
            <label className="text-xs text-[#8896a9] mb-1.5 block font-medium">
              Additional Notes <span className="text-[#c8d2e0]">(optional)</span>
            </label>
            <textarea
              value={closeNotes}
              onChange={(e) => onNotesChange(e.target.value)}
              placeholder="Final observations or remarks..."
              rows={3}
              className="w-full px-3 py-2.5 bg-[#f8f9fc] border border-[#e2e7f0] rounded-xl text-sm text-[#0f1829] placeholder-[#8896a9] focus:outline-none focus:ring-2 focus:ring-[#800040]/20 focus:border-[#800040] resize-none transition-all"
            />
          </div>
        </div>

        <div className="sticky bottom-0 bg-white px-5 py-4 border-t border-[#e2e7f0] flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 bg-[#f1f4f9] hover:bg-[#e2e7f0] border border-[#e2e7f0] text-[#4a5568] text-sm font-semibold rounded-xl transition-all"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isClosing || validationErrors.length > 0}
            id="confirm-close-btn"
            className="flex-1 py-2.5 bg-[#800040] hover:bg-[#660033] disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all flex items-center justify-center gap-2"
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
    </Modal>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function VisitDetailPage() {
  const params = useParams();
  const router = useRouter();
  const visitId = params.visitId as string;

  const [isOpening, setIsOpening] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [closeNotes, setCloseNotes] = useState("");
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const fetchVisitData = useCallback(async () => {
    const data = await fetchJSON<{ visit: Visit }>(`/api/visits/${visitId}`);
    return data.visit as Visit;
  }, [visitId]);

  // Fetch on mount + silently on focus/visibility (event-driven, no polling)
  // so admin task-config changes reach the CURRENT visit without a reload.
  // TaskCard preserves dirty local edits (isDirty guard), so in-progress
  // work is never overwritten by a background refetch.
  const { data: visit, loading: isLoading, error, refresh: fetchVisit, setData: setVisit } = useLiveQuery(fetchVisitData, {
    revalidateOnFocus: true,
    revalidateOnVisible: true,
  });
  // Background refresh indicator — only meaningful once we already have data;
  // the very first fetch is covered by the full-page skeleton below instead.
  const isRefreshing = isLoading && !!visit;

  useEffect(() => {
    if (error) toast.error("Failed to load visit");
  }, [error]);

  const handleOpenVisit = async () => {
    setIsOpening(true);
    try {
      const res = await fetch(`/api/visits/${visitId}`, { method: "PATCH" });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed");
      }
      toast.success("Visit opened!");
      await fetchVisit();
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
      await fetchVisit();
      setShowSummary(true);
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setIsClosing(false);
    }
  };

  // ─── Loading / error states ───────────────────────────────────────────────

  if (isLoading && !visit) {
    return (
      <div className="space-y-4 max-w-4xl">
        <div className="h-8 w-32 bg-[#e2e7f0] animate-pulse rounded-lg" />
        <div className="h-40 bg-white border border-[#e2e7f0] animate-pulse rounded-xl" />
        <div className="h-16 bg-white border border-[#e2e7f0] animate-pulse rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 bg-white border border-[#e2e7f0] animate-pulse rounded-xl" />
            ))}
          </div>
          <div className="h-40 bg-white border border-[#e2e7f0] animate-pulse rounded-xl" />
        </div>
      </div>
    );
  }

  if (!visit) {
    return (
      <div className="text-center py-16 text-[#8896a9]">
        <XCircle className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p className="font-medium text-[#4a5568]">Visit not found</p>
        <button onClick={() => router.push("/executive/visits")} className="mt-3 text-sm text-[#25488e] hover:underline">
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
        className="flex items-center gap-2 text-[#25488e] hover:text-[#1e3a72] text-sm font-semibold transition-colors group"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        Back to Visits
      </button>

      {/* ── Visit header card ──────────────────────────────────────── */}
      <div className="bg-white border border-[#e2e7f0] rounded-xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-xs font-mono text-[#25488e] bg-[#eef2fb] px-2 py-0.5 rounded-md border border-[#d4ddf5]">{visit.visitNumber}</span>
              {/* Deliberately keyed to the RAW workflow status, not the shared
                  displayStatus: on this screen the badge labels the exact state
                  the Open Visit / Close Visit buttons below act on. A visit at
                  100% subtasks that has not been formally closed yet still needs
                  the executive to close it, so it must read "In Progress" here. */}
              <span className={cn(
                "px-2 py-0.5 rounded-full text-xs font-semibold border",
                visit.status === "OPEN"
                  ? "text-blue-700 bg-blue-50 border-blue-200"
                  : visit.status === "CLOSED"
                  ? "text-green-700 bg-green-50 border-green-200"
                  : "text-amber-700 bg-amber-50 border-amber-200"
              )}>
                {visit.status === "OPEN" ? "In Progress" : visit.status === "PENDING" ? "Pending" : "Closed"}
              </span>
              {isRefreshing && (
                <RefreshCw className="w-3.5 h-3.5 text-[#8896a9] animate-spin" />
              )}
            </div>
            <h1 className="text-xl font-bold text-[#0f1829]">{visit.client.name}</h1>
            <p className="text-sm text-[#4a5568] mt-0.5">{visit.client.contactPerson} · {visit.client.address}</p>
            {visit.client.phone && (
              <p className="text-xs text-[#8896a9] mt-0.5">{visit.client.phone}</p>
            )}
          </div>

          <div className="flex gap-2 flex-wrap sm:flex-nowrap sm:flex-col sm:items-end">
            {visit.status === "PENDING" && (
              <button
                type="button"
                onClick={handleOpenVisit}
                disabled={isOpening}
                id="open-visit-btn"
                className="px-4 py-2.5 bg-[#25488e] hover:bg-[#1e3a72] active:bg-[#162d5c] disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-all flex items-center gap-2 shadow-sm press-effect"
              >
                {isOpening ? (
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <CheckSquare className="w-4 h-4" />
                )}
                Open Visit
              </button>
            )}

            {/* Only the visit owner (solo executive or Team Lead) may close.
                `canClose` comes from the API, which enforces the same rule. */}
            {visit.status === "OPEN" && visit.canClose !== false && (
              <button
                type="button"
                onClick={() => {
                  setValidationErrors([]);
                  setShowCloseConfirm(true);
                }}
                id="close-visit-btn"
                className="px-4 py-2.5 bg-[#800040] hover:bg-[#660033] active:bg-[#4d0030] text-white text-sm font-semibold rounded-lg transition-all flex items-center gap-2 shadow-sm press-effect"
              >
                <Lock className="w-4 h-4" />
                Close Visit
              </button>
            )}
            {visit.status === "OPEN" && visit.canClose === false && (
              <span className="px-3 py-2 text-xs font-semibold text-[#8896a9] bg-[#f1f4f9] border border-[#e2e7f0] rounded-lg">
                Only {visit.teamLead?.name ?? "the Team Lead"} can close this visit
              </span>
            )}

            {visit.status === "CLOSED" && (
              <button
                type="button"
                onClick={() => setShowSummary(true)}
                className="px-4 py-2.5 bg-[#f1f4f9] hover:bg-[#e2e7f0] border border-[#e2e7f0] text-[#4a5568] text-sm font-semibold rounded-lg transition-all flex items-center gap-2"
              >
                <FileText className="w-4 h-4" />
                View Summary
              </button>
            )}
          </div>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-[#e2e7f0] text-xs text-[#8896a9]">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            Start: <span className="text-[#4a5568] ml-0.5">{formatDate(visit.scheduledDate)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            End: <span className="text-[#4a5568] ml-0.5">{formatDate(visit.endDate ?? visit.scheduledDate)}</span>
          </div>
          {/* Team visit roster — reuses the existing meta row styling. */}
          {visit.isTeamVisit && (
            <div className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-[#25488e]" />
              Team:
              <span className="text-[#4a5568] ml-0.5">
                {visit.teamLead?.name} (Lead)
                {(visit.teamMembers ?? []).length > 0 && ` · ${(visit.teamMembers ?? []).map((m) => m.name).join(", ")}`}
              </span>
            </div>
          )}
          {visit.openedAt && (
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              Opened: <span className="text-[#4a5568] ml-0.5">{formatDateTime(visit.openedAt)}</span>
            </div>
          )}
          {visit.closedAt && (
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
              Closed: <span className="text-green-700 ml-0.5">{formatDateTime(visit.closedAt)}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <User className="w-3.5 h-3.5" />
            <span className="text-[#4a5568]">{visit.executive.name}</span>
          </div>
        </div>
      </div>

      {/* ── Progress tracker ───────────────────────────────────────── */}
      <div className="bg-white border border-[#e2e7f0] rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[#0f1829] flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[#25488e]" />
            Overall Progress
          </h2>
          <span className="text-2xl font-bold text-[#0f1829]">{visit.progress}%</span>
        </div>
        <div className="h-3 bg-[#f1f4f9] rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-500", getProgressColor(visit.progress))}
            style={{ width: `${visit.progress}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-2 text-xs text-[#8896a9]">
          <span>{visit.completedSubtasks} of {visit.totalSubtasks} subtasks</span>
          <span className={cn(
            "font-medium",
            visit.progress === 100 ? "text-green-600" : visit.progress >= 50 ? "text-[#25488e]" : "text-amber-600"
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
                    ? "bg-green-100 border-green-500 text-green-700"
                    : pct > 0
                    ? "bg-blue-50 border-[#25488e] text-[#25488e]"
                    : "bg-[#f1f4f9] border-[#e2e7f0] text-[#8896a9]"
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
          <div className="flex items-start gap-2 p-3.5 rounded-xl bg-amber-50 border border-amber-200">
            <Info className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-700">
              <span className="font-semibold">{noReason} subtask{noReason > 1 ? "s" : ""}</span> need a reason before you can close the visit.
            </p>
          </div>
        );
        return null;
      })()}

      {/* ── Tasks + Activity ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Tasks column.

            Carry-forward work is kept in its OWN section at the bottom and is
            never mixed into the normal task list: when a carried subtask joins
            a client's existing visit, that visit's own scheduled tasks stay on
            top and the carried items sit below under the "Carry Forward Tasks"
            heading — the same separation the Task Configuration page uses.
            Both lists render through the same TaskCard, so completing,
            reasons and saving behave identically in either section. */}
        <div className="lg:col-span-2 space-y-3">
          {(() => {
            const normalTasks = visit.tasks
              .map((t) => ({ ...t, subtasks: t.subtasks.filter((s) => !s.isCarriedForward) }))
              .filter((t) => t.subtasks.length > 0);
            const carriedTasks = visit.tasks
              .map((t) => ({ ...t, subtasks: t.subtasks.filter((s) => s.isCarriedForward) }))
              .filter((t) => t.subtasks.length > 0);
            const carriedCount = carriedTasks.reduce((s, t) => s + t.subtasks.length, 0);

            return (
              <>
                <h2 className="text-base font-semibold text-[#0f1829]">
                  Tasks <span className="text-[#8896a9] font-normal text-sm">({normalTasks.length})</span>
                </h2>
                {normalTasks.map((task) => (
                  <TaskCard key={task.id} task={task} isEditable={isEditable} onSave={handleSaveTask} />
                ))}
                {normalTasks.length === 0 && (
                  <p className="text-sm text-[#8896a9] bg-white border border-[#e2e7f0] rounded-xl p-4">
                    This visit has no newly scheduled tasks.
                  </p>
                )}

                {carriedTasks.length > 0 && (
                  <div className="pt-2 space-y-3">
                    <div className="flex items-center gap-2.5 px-1">
                      <div className="p-1.5 rounded-lg bg-orange-50 border border-orange-100 flex-shrink-0">
                        <RotateCcw className="w-3.5 h-3.5 text-[#ff944d]" />
                      </div>
                      <div className="min-w-0">
                        <h2 className="text-base font-semibold text-[#0f1829]">
                          Carry Forward Tasks{" "}
                          <span className="text-[#8896a9] font-normal text-sm">({carriedCount})</span>
                        </h2>
                        <p className="text-xs text-[#8896a9]">Carried from a previous visit</p>
                      </div>
                    </div>
                    {carriedTasks.map((task) => (
                      <TaskCard key={`cf-${task.id}`} task={task} isEditable={isEditable} onSave={handleSaveTask} />
                    ))}
                  </div>
                )}
              </>
            );
          })()}
        </div>

        {/* Activity sidebar */}
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-[#0f1829]">Activity</h2>
          <div className="bg-white border border-[#e2e7f0] rounded-xl p-4 shadow-sm">
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
