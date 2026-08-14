"use client";

/**
 * Admin → Carry Forward.
 *
 * ONE client-wise page. Every client with carry-forward activity gets a single
 * section, and everything about that client is decided inside it:
 *
 *   1. Pending Approval — incomplete subtasks whose visit window is over.
 *      Nothing has been copied anywhere yet. The admin ticks the ones to
 *      carry, sets THIS CLIENT's destination date, optionally re-assigns the
 *      work (Solo/Team), and approves — or removes a request outright.
 *   2. Carry Forward Tasks — what has already been carried for that client,
 *      earliest scheduled date first, where the admin can still change the
 *      executive/team and the date, or remove an individual task.
 *
 * There is deliberately no separate approval area: a global queue made the
 * admin approve across clients from one control, which is exactly what a
 * per-client destination date has to prevent.
 *
 * The four summary cards double as filters. The default view is the work that
 * still needs someone: pending approval requests + unresolved carry-forward.
 * Resolved items are reached through the Resolved (or Total Carried) card.
 */

import { RotateCcw, CheckCircle2, XCircle, ChevronDown, ChevronRight, Plus, Trash2, Settings2, CalendarDays, Check, X, Clock } from "lucide-react";
import Link from "next/link";
import { formatDate } from "@/lib/utils/utils";
import { cn } from "@/lib/utils/utils";
import { useLiveQuery, fetchJSON, revalidateAll } from "@/lib/hooks/useLiveQuery";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CarriedItem {
  id: string;
  title: string;
  taskTitle: string;
  taskType: string;
  isCompleted: boolean;
  sourceVisitNumber: string;
  sourceClosedAt: string | null;
}

interface VisitTask { id: string; taskType: string; title: string }

/** One destination visit holding carried subtasks. */
interface CarryForwardGroup {
  visitId: string;
  visitNumber: string;
  clientId: string;
  clientName: string;
  clientCode: string;
  executiveId: string;
  executiveName: string;
  visitType: "SOLO" | "TEAM";
  teamMembers: { id: string; name: string }[];
  visitStatus: string;
  scheduledDate: string;
  reason: string | null;
  visitTasks: VisitTask[];
  carriedItems: CarriedItem[];
}

/** One subtask awaiting the admin's carry-forward decision. */
interface CFRequest {
  subtaskId: string;
  subtaskTitle: string;
  incompletionReason: string | null;
  clientId: string;
  clientName: string;
  clientCode: string;
  mainTask: string;
  visitNumber: string;
  visitStatus: string;
  originalDate: string;
  currentScheduledDate: string;
  executiveId: string;
  executiveName: string;
  visitType: "SOLO" | "TEAM";
  teamMembers: { id: string; name: string }[];
}

interface Executive { id: string; name: string }

interface PageData {
  carryForwards: CarryForwardGroup[];
  requests: CFRequest[];
  executives: Executive[];
}

async function fetchAll(): Promise<PageData> {
  const [history, pending, execs] = await Promise.all([
    fetchJSON<{ carryForwards: CarryForwardGroup[] }>("/api/admin/carry-forward"),
    fetchJSON<{ requests: CFRequest[] }>("/api/admin/carry-forward/requests"),
    fetchJSON<{ executives: Executive[] }>("/api/admin/executives"),
  ]);
  return {
    carryForwards: history.carryForwards ?? [],
    requests: pending.requests ?? [],
    executives: execs.executives ?? [],
  };
}

/** Which records the page is showing. Driven by the summary cards. */
type Filter = "PENDING" | "RESOLVED" | "ALL" | "APPROVAL";

/** Per-client controls. Keyed by clientId — never shared between clients. */
interface Decision {
  date: string;
  editAssignment: boolean;
  visitType: "SOLO" | "TEAM";
  leadId: string;
  memberIds: string[];
}

const blankDecision = (src?: { executiveId?: string; visitType?: "SOLO" | "TEAM"; teamMembers?: { id: string }[] }): Decision => ({
  date: "",
  editAssignment: false,
  visitType: src?.visitType ?? "SOLO",
  leadId: src?.executiveId ?? "",
  memberIds: src?.teamMembers?.map((m) => m.id) ?? [],
});

const cleanTitle = (t: string) => t.replace("[CARRY-FORWARD] ", "");

export default function CarryForwardPage() {
  // Fetch once on mount; refreshed only by explicit mutations. No polling.
  const { data, loading, error, refresh } = useLiveQuery(fetchAll);

  const [filter, setFilter] = useState<Filter>("PENDING");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleClientSection = (clientId: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId); else next.add(clientId);
      return next;
    });

  // Approval (pending requests) and management (already-carried) are two
  // independent selections, so ticking one never submits the other.
  const [selectedRequests, setSelectedRequests] = useState<Set<string>>(new Set());
  const [selectedCarried, setSelectedCarried] = useState<Set<string>>(new Set());
  const [approve, setApprove] = useState<Record<string, Decision>>({});
  const [manage, setManage] = useState<Record<string, Decision>>({});
  const [busyClient, setBusyClient] = useState<string | null>(null);

  // Individual removals
  const [removeTarget, setRemoveTarget] = useState<CarriedItem | null>(null);
  const [dismissTarget, setDismissTarget] = useState<CFRequest | null>(null);

  // Planning actions (unchanged behaviour)
  const [addTaskFor, setAddTaskFor] = useState<string | null>(null);
  const [addTaskId, setAddTaskId] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const [addBusy, setAddBusy] = useState(false);

  useEffect(() => {
    if (error) toast.error("Failed to load carry-forward data");
  }, [error]);

  const groups = useMemo(() => data?.carryForwards ?? [], [data]);
  const requests = useMemo(() => data?.requests ?? [], [data]);
  const executives = useMemo(() => data?.executives ?? [], [data]);

  // ── Summary counts — always the FULL picture, never the filtered view ─────
  const totalCarried = groups.reduce(
    (s, g) => s + (g.carriedItems.length > 0 ? g.carriedItems.length : g.reason ? 1 : 0),
    0
  );
  const resolvedCarried = groups.reduce(
    (s, g) =>
      s +
      (g.carriedItems.length > 0
        ? g.carriedItems.filter((i) => i.isCompleted).length
        : g.reason && g.visitStatus === "CLOSED" ? 1 : 0),
    0
  );
  const stillPending = totalCarried - resolvedCarried;
  const pendingApproval = requests.length;

  // ── Client-wise sections, filtered by the selected card ───────────────────
  const showApprovalSection = filter === "PENDING" || filter === "ALL" || filter === "APPROVAL";
  const showCarriedSection = filter !== "APPROVAL";

  const sections = useMemo(() => {
    const map = new Map<string, {
      clientId: string; clientName: string; clientCode: string;
      pending: CFRequest[]; visits: CarryForwardGroup[];
    }>();
    const ensure = (clientId: string, clientName: string, clientCode: string) => {
      if (!map.has(clientId)) map.set(clientId, { clientId, clientName, clientCode, pending: [], visits: [] });
      return map.get(clientId)!;
    };

    if (showApprovalSection) {
      for (const r of requests) ensure(r.clientId, r.clientName, r.clientCode).pending.push(r);
    }

    if (showCarriedSection) {
      for (const g of groups) {
        // Resolved carry-forward is hidden from the default working list and
        // only surfaces under Resolved / Total Carried.
        const items =
          filter === "RESOLVED" ? g.carriedItems.filter((i) => i.isCompleted)
          : filter === "PENDING" ? g.carriedItems.filter((i) => !i.isCompleted)
          : g.carriedItems;
        // A visit-level carry-forward (no carried subtasks of its own) counts
        // as resolved when the visit is closed.
        const visitLevelMatches =
          g.carriedItems.length === 0 && !!g.reason &&
          (filter === "ALL" ||
            (filter === "RESOLVED" ? g.visitStatus === "CLOSED" : g.visitStatus !== "CLOSED"));
        if (items.length === 0 && !visitLevelMatches) continue;
        ensure(g.clientId, g.clientName, g.clientCode).visits.push({ ...g, carriedItems: items });
      }
    }

    const asc = (a: string, b: string) => new Date(a).getTime() - new Date(b).getTime();
    for (const s of map.values()) {
      s.pending.sort((a, b) => asc(a.originalDate, b.originalDate));
      s.visits.sort((a, b) => asc(a.scheduledDate, b.scheduledDate));
    }
    return [...map.values()]
      .filter((s) => s.pending.length > 0 || s.visits.length > 0)
      .sort((a, b) => a.clientName.localeCompare(b.clientName));
  }, [groups, requests, filter, showApprovalSection, showCarriedSection]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const decisionOf = (
    store: Record<string, Decision>,
    clientId: string,
    src?: { executiveId?: string; visitType?: "SOLO" | "TEAM"; teamMembers?: { id: string }[] }
  ): Decision => store[clientId] ?? blankDecision(src);

  const patch = (
    setStore: React.Dispatch<React.SetStateAction<Record<string, Decision>>>,
    clientId: string,
    p: Partial<Decision>,
    src?: { executiveId?: string; visitType?: "SOLO" | "TEAM"; teamMembers?: { id: string }[] }
  ) => setStore((prev) => ({ ...prev, [clientId]: { ...(prev[clientId] ?? blankDecision(src)), ...p } }));

  const toggleIn = (
    setSel: React.Dispatch<React.SetStateAction<Set<string>>>,
    id: string
  ) => setSel((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleAllIn = (
    setSel: React.Dispatch<React.SetStateAction<Set<string>>>,
    ids: string[]
  ) => setSel((prev) => {
    const allOn = ids.length > 0 && ids.every((i) => prev.has(i));
    const next = new Set(prev);
    for (const i of ids) { if (allOn) next.delete(i); else next.add(i); }
    return next;
  });

  const assignmentBody = (d: Decision) =>
    d.editAssignment
      ? {
          assignment: {
            visitType: d.visitType,
            executiveId: d.leadId,
            ...(d.visitType === "TEAM" ? { memberIds: d.memberIds } : {}),
          },
        }
      : {};

  const validateAssignment = (d: Decision): string | null => {
    if (!d.editAssignment) return null;
    if (!d.leadId) return d.visitType === "TEAM" ? "Select a Team Lead" : "Select an executive";
    if (d.visitType === "TEAM" && d.memberIds.length === 0) {
      return "A Team Visit needs at least one team member besides the Team Lead";
    }
    return null;
  };

  // ── Approve / reject pending requests — strictly one client ───────────────
  const submitApproval = async (clientId: string, items: CFRequest[], action: "approve" | "reject") => {
    const ids = items.filter((i) => selectedRequests.has(i.subtaskId)).map((i) => i.subtaskId);
    if (ids.length === 0) { toast.error("Select at least one carry-forward task for this client"); return; }

    const d = decisionOf(approve, clientId, items[0]);
    if (action === "approve") {
      if (!d.date) { toast.error("Choose a schedule date for this client"); return; }
      const err = validateAssignment(d);
      if (err) { toast.error(err); return; }
    }

    setBusyClient(clientId);
    try {
      const res = await fetch("/api/admin/carry-forward/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subtaskIds: ids,
          ...(action === "approve"
            ? { destinationDate: d.date, ...assignmentBody(d) }
            : { action: "reject" }),
        }),
      });
      const j = await res.json().catch(() => null) as
        | { error?: string; approved?: number; rejected?: number; destinations?: { created: boolean }[] }
        | null;
      if (!res.ok) { toast.error(j?.error ?? `Failed — server responded ${res.status} ${res.statusText}`); return; }
      if (action === "approve") {
        const reused = (j?.destinations ?? []).filter((x) => !x.created).length;
        toast.success(
          `${j?.approved ?? 0} task(s) carried forward` +
            (reused > 0 ? " · added to the client's existing visit" : "")
        );
      } else {
        toast.success(`${j?.rejected ?? 0} request(s) removed from carry-forward`);
      }
      setSelectedRequests((prev) => { const n = new Set(prev); for (const id of ids) n.delete(id); return n; });
      setApprove((prev) => ({ ...prev, [clientId]: blankDecision(items[0]) }));
      await refresh();
      // Approving creates/attaches real carry-forward work — every other
      // mounted screen (visits, calendar, dashboards, the executive's popup)
      // refetches once.
      revalidateAll();
    } finally { setBusyClient(null); }
  };

  // ── §7 change executive/team and/or date of already-carried tasks ─────────
  const submitManage = async (clientId: string, visits: CarryForwardGroup[]) => {
    const ids = visits
      .flatMap((v) => v.carriedItems)
      .filter((i) => !i.isCompleted && selectedCarried.has(i.id))
      .map((i) => i.id);
    if (ids.length === 0) { toast.error("Select at least one carry-forward task for this client"); return; }

    const d = decisionOf(manage, clientId, visits[0]);
    if (!d.date && !d.editAssignment) { toast.error("Choose a new date or change the assignment"); return; }
    const err = validateAssignment(d);
    if (err) { toast.error(err); return; }

    setBusyClient(clientId);
    try {
      const res = await fetch("/api/admin/carry-forward", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subtaskIds: ids,
          ...(d.date ? { destinationDate: d.date } : {}),
          ...assignmentBody(d),
        }),
      });
      const j = await res.json().catch(() => null) as { error?: string; moved?: number } | null;
      if (!res.ok) { toast.error(j?.error ?? `Failed — server responded ${res.status} ${res.statusText}`); return; }
      toast.success(`${j?.moved ?? 0} carry-forward task(s) updated`);
      setSelectedCarried((prev) => { const n = new Set(prev); for (const id of ids) n.delete(id); return n; });
      setManage((prev) => ({ ...prev, [clientId]: blankDecision(visits[0]) }));
      await refresh();
      revalidateAll();
    } finally { setBusyClient(null); }
  };

  // ── §6 individual removals ────────────────────────────────────────────────
  const handleRemoveCarried = async () => {
    if (!removeTarget) return;
    try {
      const res = await fetch(`/api/admin/carry-forward?subtaskId=${encodeURIComponent(removeTarget.id)}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(json?.error || "Failed to remove"); return; }
      toast.success("Carry-forward task removed");
      refresh();
      revalidateAll();
    } catch {
      toast.error("Error removing task");
    } finally { setRemoveTarget(null); }
  };

  const handleDismissRequest = async () => {
    if (!dismissTarget) return;
    try {
      const res = await fetch("/api/admin/carry-forward/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subtaskIds: [dismissTarget.subtaskId], action: "reject" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(json?.error || "Failed to remove the request"); return; }
      toast.success("Carry-forward request removed");
      refresh();
      revalidateAll();
    } catch {
      toast.error("Error removing the request");
    } finally { setDismissTarget(null); }
  };

  // ── Planning actions (unchanged) ──────────────────────────────────────────
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
    } finally { setAddBusy(false); }
  };

  if (loading && !data) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-[#0f1829]">Carry Forward</h1>
          <p className="text-[#8896a9] text-sm mt-1">Loading carry-forward activity…</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }

  // ── Summary cards double as filters ───────────────────────────────────────
  const cards: { key: Filter; label: string; value: number; icon: React.ReactNode; tint: string; text: string }[] = [
    { key: "ALL", label: "Total Carried", value: totalCarried, icon: <RotateCcw className="w-5 h-5 text-[#ff944d]" />, tint: "bg-orange-50", text: "text-[#ff944d]" },
    { key: "RESOLVED", label: "Resolved", value: resolvedCarried, icon: <CheckCircle2 className="w-5 h-5 text-green-600" />, tint: "bg-green-50", text: "text-green-600" },
    { key: "PENDING", label: "Still Pending", value: stillPending, icon: <XCircle className="w-5 h-5 text-[#800040]" />, tint: "bg-[#fff0f6]", text: "text-[#800040]" },
    { key: "APPROVAL", label: "Pending Approval", value: pendingApproval, icon: <Clock className="w-5 h-5 text-amber-600" />, tint: "bg-amber-50", text: "text-amber-600" },
  ];

  const FILTER_HINT: Record<Filter, string> = {
    PENDING: "Showing carry-forward that still needs action — pending approval requests and unresolved tasks",
    RESOLVED: "Showing resolved carry-forward tasks only",
    ALL: "Showing every carry-forward record, resolved and unresolved",
    APPROVAL: "Showing carry-forward requests awaiting your approval",
  };

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#0f1829]">Carry Forward</h1>
        <p className="text-[#8896a9] text-sm mt-1">
          Nothing is carried forward until you approve it — review each client, choose their schedule date and approve
        </p>
      </div>

      {/* Summary cards / filters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((c) => {
          const active = filter === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setFilter(c.key)}
              aria-pressed={active}
              className={cn(
                "bg-white border rounded-2xl p-4 sm:p-5 text-left transition-all press-effect",
                active
                  ? "border-[#25488e] ring-2 ring-[#25488e]/20 shadow-sm"
                  : "border-[#e2e7f0] hover:border-[#c8d2e0] hover:shadow-sm"
              )}
            >
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center mb-3", c.tint)}>
                {c.icon}
              </div>
              <p className="text-sm text-[#8896a9]">{c.label}</p>
              <p className={cn("text-2xl sm:text-3xl font-bold mt-1", c.text)}>{c.value}</p>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-[#8896a9] -mt-2">{FILTER_HINT[filter]}</p>

      {/* Client sections */}
      {sections.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 bg-white border border-[#e2e7f0] rounded-2xl text-[#8896a9]">
          <div className="w-12 h-12 rounded-xl bg-[#f1f4f9] flex items-center justify-center mb-3">
            <RotateCcw className="w-6 h-6 text-[#c8d2e0]" />
          </div>
          <p className="text-sm font-medium text-[#4a5568]">
            {filter === "RESOLVED" ? "No resolved carry-forward tasks yet"
              : filter === "APPROVAL" ? "No carry-forward requests awaiting approval"
              : "No carry-forward items found"}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {sections.map((section) => {
            const isExpanded = !collapsed.has(section.clientId);
            const firstReq = section.pending[0];
            const firstVisit = section.visits[0];
            const aD = decisionOf(approve, section.clientId, firstReq);
            const mD = decisionOf(manage, section.clientId, firstVisit);
            const busy = busyClient === section.clientId;

            const reqIds = section.pending.map((r) => r.subtaskId);
            const reqSelected = reqIds.filter((id) => selectedRequests.has(id)).length;
            const reqAllOn = reqIds.length > 0 && reqSelected === reqIds.length;

            const carriedIds = section.visits.flatMap((v) => v.carriedItems).filter((i) => !i.isCompleted).map((i) => i.id);
            const carriedSelected = carriedIds.filter((id) => selectedCarried.has(id)).length;
            const carriedAllOn = carriedIds.length > 0 && carriedSelected === carriedIds.length;

            const carriedTotal = section.visits.reduce((s, g) => s + g.carriedItems.length, 0);

            return (
              <div key={section.clientId} className="bg-white border border-[#e2e7f0] rounded-2xl overflow-hidden shadow-sm">
                {/* ── Client header ───────────────────────────────────────── */}
                <button
                  type="button"
                  onClick={() => toggleClientSection(section.clientId)}
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
                      <p className="text-sm font-semibold text-[#0f1829] truncate">{section.clientName}</p>
                      <p className="text-xs text-[#8896a9] font-mono">{section.clientCode}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {section.pending.length > 0 && (
                      <span className="px-2 sm:px-2.5 py-1 rounded-full text-[10px] sm:text-xs font-semibold border text-amber-700 bg-amber-50 border-amber-200 whitespace-nowrap">
                        {section.pending.length} awaiting approval
                      </span>
                    )}
                    {carriedTotal > 0 && (
                      <span className="px-2 sm:px-2.5 py-1 rounded-full text-[10px] sm:text-xs font-semibold border text-[#ff944d] bg-orange-50 border-orange-200 whitespace-nowrap">
                        {carriedTotal} carried
                      </span>
                    )}
                  </div>
                </button>

                {isExpanded && (
                  <>
                    {/* ── 1. Pending Approval ──────────────────────────────── */}
                    {section.pending.length > 0 && (
                      <div className="border-b border-[#e2e7f0]">
                        <div className="px-3.5 sm:px-5 py-2.5 bg-amber-50/60 border-b border-amber-100 flex items-center justify-between gap-2">
                          <p className="text-xs font-bold text-amber-800 flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5" />
                            Pending Approval ({section.pending.length})
                          </p>
                          <button
                            type="button"
                            onClick={() => toggleAllIn(setSelectedRequests, reqIds)}
                            className="text-[11px] font-semibold text-[#25488e] hover:underline"
                          >
                            {reqAllOn ? "Clear selection" : "Select All"}
                          </button>
                        </div>

                        <div className="divide-y divide-[#f1f4f9]">
                          {section.pending.map((r) => {
                            const checked = selectedRequests.has(r.subtaskId);
                            return (
                              <div
                                key={r.subtaskId}
                                className={cn(
                                  "flex items-start gap-3 px-3.5 sm:px-5 py-3 transition-colors",
                                  checked ? "bg-[#eef2fb]" : "hover:bg-[#f8f9fc]"
                                )}
                              >
                                <label className="flex items-start gap-3 flex-1 min-w-0 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleIn(setSelectedRequests, r.subtaskId)}
                                    className="w-4 h-4 mt-0.5 accent-[#25488e] flex-shrink-0"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-[#0f1829] break-words">{r.subtaskTitle}</p>
                                    <p className="text-xs text-[#8896a9]">{r.mainTask}</p>
                                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#8896a9] mt-1.5">
                                      <span>Client: <span className="text-[#4a5568]">{r.clientName}</span></span>
                                      <span>Previous Executive: <span className="text-[#4a5568]">{r.executiveName}</span>
                                        {r.visitType === "TEAM" && r.teamMembers.length > 0 && (
                                          <span className="text-[#4a5568]"> +{r.teamMembers.length}</span>
                                        )}
                                      </span>
                                      <span className="flex items-center gap-1">
                                        <CalendarDays className="w-3 h-3" />
                                        {r.visitNumber} · {formatDate(r.originalDate)}
                                      </span>
                                      <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-semibold">
                                        Awaiting approval
                                      </span>
                                    </div>
                                    {r.incompletionReason && (
                                      <p className="text-[11px] text-[#8896a9] mt-1 italic break-words">Reason: {r.incompletionReason}</p>
                                    )}
                                  </div>
                                </label>
                                {/* §6 — remove THIS request only */}
                                <button
                                  type="button"
                                  onClick={() => setDismissTarget(r)}
                                  title="Remove this carry-forward request"
                                  className="p-1.5 rounded-lg bg-[#f1f4f9] hover:bg-red-50 text-[#8896a9] hover:text-red-600 transition-colors border border-[#e2e7f0] flex-shrink-0"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            );
                          })}
                        </div>

                        {/* ── Client-level approval bar ────────────────────── */}
                        <div className="px-3.5 sm:px-5 py-3 bg-[#f8f9fc] border-t border-[#e2e7f0] space-y-3">
                          <div className="flex flex-wrap items-end gap-3">
                            <div>
                              <label className="block text-[11px] text-[#8896a9] font-semibold mb-1">
                                Schedule Date for {section.clientName}
                              </label>
                              <input
                                type="date"
                                value={aD.date}
                                onChange={(e) => patch(setApprove, section.clientId, { date: e.target.value }, firstReq)}
                                aria-label={`Schedule date for ${section.clientName}`}
                                className="border border-[#e2e7f0] rounded-lg px-3 py-2 text-sm text-[#0f1829] bg-white focus:outline-none focus:ring-2 focus:ring-[#25488e]/30"
                              />
                            </div>
                            <div className="flex-1 min-w-[180px]">
                              <p className="text-[11px] text-[#8896a9] font-semibold mb-1">Assignment</p>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => patch(setApprove, section.clientId, { editAssignment: false }, firstReq)}
                                  className={cn(
                                    "flex-1 py-2 rounded-lg text-xs font-semibold border transition-colors",
                                    !aD.editAssignment ? "bg-[#25488e] text-white border-[#25488e]" : "bg-white text-[#4a5568] border-[#e2e7f0] hover:bg-[#f1f4f9]"
                                  )}
                                >
                                  Keep {firstReq?.executiveName ?? "previous executive"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => patch(setApprove, section.clientId, { editAssignment: true }, firstReq)}
                                  className={cn(
                                    "flex-1 py-2 rounded-lg text-xs font-semibold border transition-colors",
                                    aD.editAssignment ? "bg-[#25488e] text-white border-[#25488e]" : "bg-white text-[#4a5568] border-[#e2e7f0] hover:bg-[#f1f4f9]"
                                  )}
                                >
                                  Change Assignment
                                </button>
                              </div>
                            </div>
                          </div>

                          {aD.editAssignment && (
                            <AssignmentPicker
                              decision={aD}
                              executives={executives}
                              onChange={(p) => patch(setApprove, section.clientId, p, firstReq)}
                            />
                          )}

                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-[#4a5568]">{reqSelected} selected</span>
                            <div className="flex gap-2 ml-auto">
                              <button
                                type="button"
                                onClick={() => submitApproval(section.clientId, section.pending, "reject")}
                                disabled={busy || reqSelected === 0}
                                className="px-3 py-2 rounded-lg border border-[#e2e7f0] bg-white text-[#4a5568] text-sm font-semibold hover:bg-[#f1f4f9] transition-colors disabled:opacity-50 flex items-center gap-1.5"
                              >
                                <X className="w-3.5 h-3.5" /> Reject
                              </button>
                              <button
                                type="button"
                                onClick={() => submitApproval(section.clientId, section.pending, "approve")}
                                disabled={busy || reqSelected === 0 || !aD.date}
                                className="px-4 py-2 rounded-lg bg-[#25488e] hover:bg-[#1e3a72] text-white text-sm font-bold transition-colors press-effect disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                              >
                                <Check className="w-3.5 h-3.5" />
                                {busy ? "Working…" : "Approve for Carry Forward"}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ── 2. Already-carried tasks, earliest date first ────── */}
                    {section.visits.length === 0 ? (
                      section.pending.length === 0 && (
                        <p className="px-5 py-4 text-xs text-[#8896a9]">No carry-forward tasks for this client.</p>
                      )
                    ) : (
                      <>
                        <div className="px-3.5 sm:px-5 py-2.5 bg-orange-50/40 border-b border-orange-100 flex items-center justify-between gap-2">
                          <p className="text-xs font-bold text-[#a35418] flex items-center gap-1.5">
                            <RotateCcw className="w-3.5 h-3.5" />
                            Carry Forward Tasks ({carriedTotal})
                          </p>
                          {carriedIds.length > 0 && (
                            <button
                              type="button"
                              onClick={() => toggleAllIn(setSelectedCarried, carriedIds)}
                              className="text-[11px] font-semibold text-[#25488e] hover:underline"
                            >
                              {carriedAllOn ? "Clear selection" : "Select All"}
                            </button>
                          )}
                        </div>

                        {section.visits.map((group) => {
                          const isEditable = group.visitStatus !== "CLOSED";
                          return (
                            <div key={group.visitId} className="border-b border-[#f1f4f9] last:border-b-0">
                              <div className="px-3.5 sm:px-5 py-2.5 bg-[#f8f9fc]/70 flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex items-center gap-2 flex-wrap min-w-0">
                                  <span className="text-xs text-[#8896a9] font-mono bg-[#f1f4f9] px-1.5 py-0.5 rounded">
                                    {group.visitNumber}
                                  </span>
                                  <span className="text-xs text-[#8896a9]">
                                    {group.executiveName}
                                    {group.visitType === "TEAM" && group.teamMembers.length > 0 &&
                                      ` +${group.teamMembers.length}`}
                                    {" · Scheduled "}{formatDate(group.scheduledDate)}
                                  </span>
                                  {group.reason && (
                                    <span className="text-[10px] font-bold text-[#ff944d] bg-orange-100 px-1.5 py-0.5 rounded-full">
                                      {group.reason}
                                    </span>
                                  )}
                                </div>
                                <span className={cn(
                                  "px-2 py-0.5 rounded-full text-[10px] font-semibold border flex-shrink-0 whitespace-nowrap",
                                  group.visitStatus === "CLOSED"
                                    ? "text-green-700 bg-green-50 border-green-200"
                                    : group.visitStatus === "OPEN"
                                    ? "text-blue-700 bg-blue-50 border-blue-200"
                                    : "text-amber-700 bg-amber-50 border-amber-200"
                                )}>
                                  {group.visitStatus === "OPEN" ? "In Progress" : group.visitStatus.charAt(0) + group.visitStatus.slice(1).toLowerCase()}
                                </span>
                              </div>

                              {group.carriedItems.length === 0 ? (
                                <div className="px-5 py-3 text-xs text-[#8896a9]">
                                  No individual carried subtasks on this visit.
                                </div>
                              ) : (
                                <div className="divide-y divide-[#f1f4f9]">
                                  {group.carriedItems.map((item) => {
                                    const selectable = !item.isCompleted && isEditable;
                                    const checked = selectedCarried.has(item.id);
                                    return (
                                      <div key={item.id} className={cn(
                                        "px-3.5 sm:px-5 py-3 flex items-start gap-2.5 sm:gap-4 flex-wrap sm:flex-nowrap transition-colors",
                                        checked ? "bg-[#eef2fb]" : "hover:bg-[#f8f9fc]"
                                      )}>
                                        {selectable ? (
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => toggleIn(setSelectedCarried, item.id)}
                                            aria-label={`Select ${cleanTitle(item.title)}`}
                                            className="w-4 h-4 mt-0.5 accent-[#25488e] flex-shrink-0"
                                          />
                                        ) : (
                                          <span className="w-4 flex-shrink-0" />
                                        )}
                                        {item.isCompleted ? (
                                          <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                                        ) : (
                                          <XCircle className="w-4 h-4 text-[#800040] mt-0.5 flex-shrink-0" />
                                        )}
                                        <div className="flex-1 min-w-0 basis-48">
                                          <p className="text-sm text-[#0f1829] break-words">{cleanTitle(item.title)}</p>
                                          <p className="text-xs text-[#8896a9] mt-0.5">{item.taskTitle}</p>
                                          {item.sourceVisitNumber !== "N/A" && (
                                            <div className="flex items-center gap-1 mt-1">
                                              <span className="text-xs text-[#8896a9]">From</span>
                                              <span className="text-xs text-[#ff944d] font-mono font-medium">{item.sourceVisitNumber}</span>
                                              {item.sourceClosedAt && (
                                                <span className="text-xs text-[#8896a9]">(closed {formatDate(item.sourceClosedAt)})</span>
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
                                            title="Remove this carry-forward task"
                                            className="p-1.5 rounded-lg bg-[#f1f4f9] hover:bg-red-50 text-[#8896a9] hover:text-red-600 transition-colors border border-[#e2e7f0] flex-shrink-0"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {/* Planning actions — unchanged */}
                              {isEditable && (
                                <div className="px-3.5 sm:px-5 py-3 border-t border-[#f1f4f9] bg-[#f8f9fc]/60">
                                  {addTaskFor === group.visitId ? (
                                    <form onSubmit={handleAddTask} className="flex flex-col sm:flex-row gap-2">
                                      <select
                                        value={addTaskId}
                                        onChange={(e) => setAddTaskId(e.target.value)}
                                        aria-label="Main task"
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
                                        <button type="submit" disabled={addBusy}
                                          className="px-3 py-2 rounded-lg bg-[#25488e] hover:bg-[#1e3a72] disabled:opacity-50 text-white text-xs font-semibold transition-colors">
                                          {addBusy ? "Adding…" : "Add"}
                                        </button>
                                        <button type="button" onClick={() => { setAddTaskFor(null); setAddTitle(""); }}
                                          className="px-3 py-2 rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#4a5568] text-xs font-semibold transition-colors border border-[#e2e7f0]">
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
                            </div>
                          );
                        })}

                        {/* ── §7 change executive / team / date for selected ── */}
                        {carriedIds.length > 0 && (
                          <div className="px-3.5 sm:px-5 py-3 bg-[#f8f9fc] border-t border-[#e2e7f0] space-y-3">
                            <div className="flex flex-wrap items-end gap-3">
                              <div>
                                <label className="block text-[11px] text-[#8896a9] font-semibold mb-1">
                                  New Date for {section.clientName}
                                </label>
                                <input
                                  type="date"
                                  value={mD.date}
                                  onChange={(e) => patch(setManage, section.clientId, { date: e.target.value }, firstVisit)}
                                  aria-label={`New carry-forward date for ${section.clientName}`}
                                  className="border border-[#e2e7f0] rounded-lg px-3 py-2 text-sm text-[#0f1829] bg-white focus:outline-none focus:ring-2 focus:ring-[#25488e]/30"
                                />
                              </div>
                              <div className="flex-1 min-w-[180px]">
                                <p className="text-[11px] text-[#8896a9] font-semibold mb-1">Assignment</p>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => patch(setManage, section.clientId, { editAssignment: false }, firstVisit)}
                                    className={cn(
                                      "flex-1 py-2 rounded-lg text-xs font-semibold border transition-colors",
                                      !mD.editAssignment ? "bg-[#25488e] text-white border-[#25488e]" : "bg-white text-[#4a5568] border-[#e2e7f0] hover:bg-[#f1f4f9]"
                                    )}
                                  >
                                    Keep {firstVisit?.executiveName ?? "current executive"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => patch(setManage, section.clientId, { editAssignment: true }, firstVisit)}
                                    className={cn(
                                      "flex-1 py-2 rounded-lg text-xs font-semibold border transition-colors",
                                      mD.editAssignment ? "bg-[#25488e] text-white border-[#25488e]" : "bg-white text-[#4a5568] border-[#e2e7f0] hover:bg-[#f1f4f9]"
                                    )}
                                  >
                                    Change Executive
                                  </button>
                                </div>
                              </div>
                            </div>

                            {mD.editAssignment && (
                              <AssignmentPicker
                                decision={mD}
                                executives={executives}
                                onChange={(p) => patch(setManage, section.clientId, p, firstVisit)}
                              />
                            )}

                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-semibold text-[#4a5568]">{carriedSelected} selected</span>
                              <button
                                type="button"
                                onClick={() => submitManage(section.clientId, section.visits)}
                                disabled={busy || carriedSelected === 0 || (!mD.date && !mD.editAssignment)}
                                className="ml-auto px-4 py-2 rounded-lg bg-[#25488e] hover:bg-[#1e3a72] text-white text-sm font-bold transition-colors press-effect disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                              >
                                <CalendarDays className="w-3.5 h-3.5" />
                                {busy ? "Working…" : "Update Carry Forward"}
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Individual removals (in-app, no browser popups) ── */}
      <ConfirmDialog
        isOpen={!!removeTarget}
        title="Remove Carry-Forward Task"
        message={<>Remove <strong className="text-[#0f1829]">&quot;{removeTarget ? cleanTitle(removeTarget.title) : ""}&quot;</strong> from the visit it was carried into? Only this carry-forward copy is removed — the original task, subtask template and visit history are not affected.</>}
        confirmLabel="Remove"
        danger
        onConfirm={handleRemoveCarried}
        onCancel={() => setRemoveTarget(null)}
      />

      <ConfirmDialog
        isOpen={!!dismissTarget}
        title="Remove Carry-Forward Request"
        message={<>Remove the carry-forward request for <strong className="text-[#0f1829]">&quot;{dismissTarget?.subtaskTitle}&quot;</strong>? It will stop appearing as awaiting approval. The original subtask stays exactly as it is on visit {dismissTarget?.visitNumber}.</>}
        confirmLabel="Remove"
        danger
        onConfirm={handleDismissRequest}
        onCancel={() => setDismissTarget(null)}
      />
    </div>
  );
}

/**
 * Solo/Team picker — the app's existing assignment model, shared by the
 * approval bar and the change-executive bar so both behave identically.
 */
function AssignmentPicker({
  decision,
  executives,
  onChange,
}: {
  decision: Decision;
  executives: Executive[];
  onChange: (p: Partial<Decision>) => void;
}) {
  return (
    <div className="space-y-2.5 border border-[#e2e7f0] rounded-xl bg-white p-3">
      <div className="flex gap-2">
        {(["SOLO", "TEAM"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onChange({ visitType: t, memberIds: [] })}
            className={cn(
              "flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors",
              decision.visitType === t
                ? "bg-[#25488e] text-white border-[#25488e]"
                : "bg-white text-[#4a5568] border-[#e2e7f0] hover:bg-[#f1f4f9]"
            )}
          >
            {t === "SOLO" ? "Solo Visit" : "Team Visit"}
          </button>
        ))}
      </div>
      <select
        value={decision.leadId}
        onChange={(e) => onChange({ leadId: e.target.value, memberIds: decision.memberIds.filter((id) => id !== e.target.value) })}
        aria-label={decision.visitType === "TEAM" ? "Team Lead" : "Executive"}
        className="w-full border border-[#e2e7f0] rounded-lg px-3 py-2 text-sm text-[#0f1829] bg-white focus:outline-none focus:ring-2 focus:ring-[#25488e]/30"
      >
        <option value="">{decision.visitType === "TEAM" ? "Select Team Lead…" : "Select Executive…"}</option>
        {executives.map((ex) => <option key={ex.id} value={ex.id}>{ex.name}</option>)}
      </select>
      {decision.visitType === "TEAM" && (
        <div className="border border-[#e2e7f0] rounded-lg divide-y divide-[#f1f4f9] max-h-32 overflow-y-auto">
          {executives.filter((ex) => ex.id !== decision.leadId).map((ex) => {
            const on = decision.memberIds.includes(ex.id);
            return (
              <label key={ex.id} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-[#f8fafc]">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onChange({ memberIds: on ? decision.memberIds.filter((id) => id !== ex.id) : [...decision.memberIds, ex.id] })}
                  className="w-4 h-4 accent-[#25488e]"
                />
                <span className="text-sm text-[#0f1829]">{ex.name}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
