"use client";

import { useState, useEffect, useCallback } from "react";
import { ClipboardList, CheckCircle2, XCircle, Clock, RefreshCw, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/utils";
import { SkeletonCard } from "@/components/ui/Skeleton";
import toast from "react-hot-toast";
import { useLiveQuery, fetchJSON } from "@/lib/hooks/useLiveQuery";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Executive { id: string; name: string; email: string }
interface LeaveRequest {
  id: string;
  date: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  adminComment: string | null;
  reviewedAt: string | null;
  createdAt: string;
  executive: Executive;
  reviewedBy: { name: string } | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

// ─── Leave Card (with inline approve/reject) ───────────────────────────────
function LeaveCard({
  leave,
  onAction,
}: {
  leave: LeaveRequest;
  onAction: (id: string, action: "approve" | "reject", comment: string) => Promise<void>;
}) {
  const [comment, setComment] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleAction = async (action: "approve" | "reject") => {
    setSubmitting(true);
    try {
      await onAction(leave.id, action, comment);
    } finally {
      setSubmitting(false);
    }
  };

  const statusColors = {
    PENDING:  "bg-amber-50 border-amber-200 text-amber-700",
    APPROVED: "bg-green-50 border-green-200 text-green-700",
    REJECTED: "bg-red-50   border-red-200   text-red-700",
  };

  return (
    <div className="bg-white border border-[#e2e7f0] rounded-xl shadow-sm overflow-hidden">
      {/* Header row */}
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-[#25488e] flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
              {leave.executive.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-[#0f1829]">{leave.executive.name}</p>
              <p className="text-xs text-[#8896a9] truncate">{leave.executive.email}</p>
            </div>
          </div>
          <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0", statusColors[leave.status])}>
            {leave.status}
          </span>
        </div>

        <div className="mt-3 flex items-center gap-4 text-xs text-[#8896a9]">
          <span className="font-semibold text-[#0f1829]">{fmtDate(leave.date)}</span>
          <span>Applied {fmtDate(leave.createdAt)}</span>
        </div>

        <p className="mt-2 text-sm text-[#4a5568]">{leave.reason}</p>

        {leave.adminComment && (
          <p className="mt-2 text-xs text-[#8896a9] italic border-t border-[#f1f4f9] pt-2">
            Admin note: {leave.adminComment}
            {leave.reviewedBy && ` (${leave.reviewedBy.name})`}
          </p>
        )}
      </div>

      {/* Action panel — only for pending */}
      {leave.status === "PENDING" && (
        <div className="border-t border-[#f1f4f9] bg-[#f8f9fc]">
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center justify-between px-5 py-2.5 text-xs font-semibold text-[#25488e] hover:text-[#1e3a72] transition-colors"
          >
            Review request
            <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", expanded && "rotate-180")} />
          </button>

          {expanded && (
            <div className="px-5 pb-4 space-y-3">
              <div>
                <label className="text-xs font-semibold text-[#4a5568] mb-1 block">Admin Comment (optional)</label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Add a note for the executive…"
                  rows={2}
                  className="w-full border border-[#e2e7f0] rounded-lg px-3 py-2 text-sm text-[#0f1829] bg-white focus:outline-none focus:ring-2 focus:ring-[#25488e]/30 resize-none"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleAction("approve")}
                  disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 rounded-lg text-sm transition-colors press-effect disabled:opacity-60"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {submitting ? "…" : "Approve"}
                </button>
                <button
                  onClick={() => handleAction("reject")}
                  disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 rounded-lg text-sm transition-colors press-effect disabled:opacity-60"
                >
                  <XCircle className="w-4 h-4" />
                  {submitting ? "…" : "Reject"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function AdminLeavesPage() {
  const [statusFilter, setStatusFilter] = useState<"PENDING" | "APPROVED" | "REJECTED" | "all">("PENDING");
  const [monthFilter, setMonthFilter] = useState(() => new Date().toISOString().slice(0, 7));

  const fetchLeaves = useCallback(async () => {
    const params = new URLSearchParams({ status: statusFilter });
    if (monthFilter) params.set("month", monthFilter);
    const json = await fetchJSON<{ leaves: LeaveRequest[] }>(`/api/admin/leaves?${params.toString()}`);
    return json.leaves ?? [];
  }, [statusFilter, monthFilter]);

  const { data, loading, refresh: refreshLeaves } = useLiveQuery(fetchLeaves);
  const leaves = data ?? [];

  const handleAction = async (id: string, action: "approve" | "reject", comment: string) => {
    try {
      const res = await fetch(`/api/leaves/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, comment }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? "Action failed");
        return;
      }
      toast.success(action === "approve" ? "Leave approved" : "Leave rejected");
      await refreshLeaves();
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong");
    }
  };

  const tabs: { key: typeof statusFilter; label: string }[] = [
    { key: "PENDING",  label: "Pending"  },
    { key: "APPROVED", label: "Approved" },
    { key: "REJECTED", label: "Rejected" },
    { key: "all",      label: "All"      },
  ];

  const pendingCount = leaves.filter((l) => l.status === "PENDING").length;

  return (
    <div className="animate-in space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0f1829]">Leave Approvals</h1>
          <p className="text-sm text-[#8896a9] mt-0.5">
            {pendingCount > 0
              ? `${pendingCount} pending request${pendingCount !== 1 ? "s" : ""} awaiting review`
              : "No pending requests"}
          </p>
        </div>
        <button
          onClick={refreshLeaves}
          disabled={loading}
          className="p-2 rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#8896a9] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
        </button>
      </div>

      {/* ── Status tabs + month filter ── */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="flex gap-1 p-1 bg-[#f8f9fc] rounded-lg border border-[#e2e7f0]">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={cn(
                "flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
                statusFilter === tab.key
                  ? "bg-white text-[#25488e] shadow-sm border border-[#e2e7f0]"
                  : "text-[#8896a9] hover:text-[#4a5568]"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="border border-[#e2e7f0] rounded-lg px-3 py-2 text-sm text-[#0f1829] bg-white focus:outline-none focus:ring-2 focus:ring-[#25488e]/30"
          />
          {monthFilter && (
            <button
              onClick={() => setMonthFilter("")}
              className="text-xs font-semibold text-[#25488e] hover:text-[#1e3a72] px-2 py-1 transition-colors"
            >
              All time
            </button>
          )}
        </div>
      </div>

      {/* ── Leave cards ── */}
      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : leaves.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-14 h-14 rounded-2xl bg-[#f1f4f9] flex items-center justify-center mb-4">
            <ClipboardList className="w-7 h-7 text-[#c8d2e0]" />
          </div>
          <p className="text-sm font-medium text-[#4a5568]">No {statusFilter !== "all" ? statusFilter.toLowerCase() : ""} leave requests</p>
          <p className="text-xs text-[#8896a9] mt-1">
            {statusFilter === "PENDING"
              ? "No pending requests. Raise a leave as an Executive to see it here."
              : "Nothing to show for this filter."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {leaves.map((leave) => (
            <LeaveCard key={leave.id} leave={leave} onAction={handleAction} />
          ))}
        </div>
      )}

      {/* ── Empty pending ── */}
      {!loading && statusFilter === "PENDING" && leaves.length === 0 && (
        <div className="bg-white border border-[#e2e7f0] rounded-xl p-5 flex items-center gap-3">
          <Clock className="w-5 h-5 text-[#8896a9]" />
          <p className="text-sm text-[#8896a9]">
            No pending requests. Raise a leave as the Executive to see it land here.
          </p>
        </div>
      )}
    </div>
  );
}
