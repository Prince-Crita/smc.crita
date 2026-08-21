"use client";

/**
 * Executive → Carry Forward popup.
 *
 * Shows ONLY genuine carry-forward tasks (rows with isCarriedForward), served
 * by GET /api/carry-forward. Normal pending/upcoming tasks are deliberately
 * absent — this is not a second "pending" list.
 *
 * Grouped BY CLIENT: each client gets one section with its own task
 * checkboxes, its own Select All, and its own destination date. Rescheduling
 * applies that client's date to that client's selected tasks only — a single
 * global date could never express "Client A → 14 Aug, Client B → 18 Aug".
 *
 * When the client already has a visit on the chosen date the task joins that
 * visit (server-side, §3) instead of a duplicate being created.
 */
import { useCallback, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { RotateCcw, CalendarDays, Building2, User } from "lucide-react";
import toast from "react-hot-toast";
import { useLiveQuery, fetchJSON, revalidateAll } from "@/lib/hooks/useLiveQuery";
import { cn } from "@/lib/utils/utils";

export interface CarryForwardItem {
  subtaskId: string;
  subtaskTitle: string;
  isCompleted: boolean;
  mainTask: string;
  taskType: string;
  clientId: string;
  clientName: string;
  clientCode: string;
  executiveName: string;
  visitId: string;
  visitNumber: string;
  visitStatus: string;
  currentScheduledDate: string;
  originalVisitNumber: string | null;
  originalDate: string | null;
}

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export function CarryForwardModal({ onClose }: { onClose: () => void }) {
  const [busyClient, setBusyClient] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Destination date per client — never shared between clients. */
  const [dateByClient, setDateByClient] = useState<Record<string, string>>({});

  // Reuses the app's existing live-query hook (mutation + focus/visibility
  // driven) — no extra polling loop is introduced.
  const { data, loading, refresh } = useLiveQuery(
    useCallback(() => fetchJSON<{ carryForwards: CarryForwardItem[] }>("/api/carry-forward"), [])
  );
  const items = useMemo(() => data?.carryForwards ?? [], [data]);

  /** Client-wise grouping, keyed by clientId (names are not unique). */
  const groups = useMemo(() => {
    const m = new Map<string, { clientId: string; clientName: string; clientCode: string; items: CarryForwardItem[] }>();
    for (const i of items) {
      if (!m.has(i.clientId)) {
        m.set(i.clientId, { clientId: i.clientId, clientName: i.clientName, clientCode: i.clientCode, items: [] });
      }
      m.get(i.clientId)!.items.push(i);
    }
    for (const g of m.values()) {
      g.items.sort(
        (a, b) => new Date(a.currentScheduledDate).getTime() - new Date(b.currentScheduledDate).getTime()
      );
    }
    return [...m.values()].sort((a, b) => a.clientName.localeCompare(b.clientName));
  }, [items]);

  const toggleOne = (subtaskId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(subtaskId)) next.delete(subtaskId); else next.add(subtaskId);
      return next;
    });

  const toggleClientAll = (clientItems: CarryForwardItem[]) =>
    setSelected((prev) => {
      const allOn = clientItems.length > 0 && clientItems.every((i) => prev.has(i.subtaskId));
      const next = new Set(prev);
      for (const i of clientItems) { if (allOn) next.delete(i.subtaskId); else next.add(i.subtaskId); }
      return next;
    });

  /** Move this client's selected carry-forward tasks to this client's date. */
  const reschedule = async (clientId: string, clientItems: CarryForwardItem[]) => {
    const date = dateByClient[clientId];
    const chosen = clientItems.filter((i) => selected.has(i.subtaskId));
    if (chosen.length === 0) { toast.error("Select at least one task for this client"); return; }
    if (!date) { toast.error("Pick a date for this client"); return; }

    setBusyClient(clientId);
    try {
      let moved = 0, reused = 0;
      const failures: string[] = [];
      for (const item of chosen) {
        const res = await fetch("/api/carry-forward", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subtaskId: item.subtaskId, date }),
        });
        const j = await res.json().catch(() => null) as
          | { error?: string; movedToExistingVisit?: boolean; visitNumber?: string }
          | null;
        if (!res.ok) { failures.push(j?.error ?? `${res.status} ${res.statusText}`); continue; }
        moved++;
        if (j?.movedToExistingVisit) reused++;
      }
      if (moved > 0) {
        toast.success(
          `${moved} task(s) rescheduled to ${fmt(date)}` +
            (reused > 0 ? " · added to the existing visit for this client" : "")
        );
      }
      if (failures.length > 0) toast.error(failures[0]);
      setSelected((prev) => {
        const next = new Set(prev);
        for (const i of chosen) next.delete(i.subtaskId);
        return next;
      });
      setDateByClient((p) => ({ ...p, [clientId]: "" }));
      // Push the change to every mounted screen — this popup, the dashboard,
      // visits, calendar, visit details — so the new date is visible without
      // the executive refreshing anything. Mutation-driven and one-shot: no
      // polling, no refresh loop.
      //
      // revalidateAll() already refetches THIS popup's own query (it is a
      // mounted live query like any other), so the explicit refresh() that
      // used to precede it only ever produced a second, identical request for
      // /api/carry-forward on every reschedule.
      revalidateAll();
    } finally { setBusyClient(null); }
  };

  return (
    <Modal isOpen title="Carry Forward Tasks" onClose={onClose} size="lg" fullScreenOnMobile>
      <div className="p-4 space-y-3">
        <p className="text-xs text-[#8896a9]">
          Only carry-forward tasks are listed here. Normal pending tasks stay on your visit pages.
        </p>

        {loading && <p className="text-sm text-[#8896a9] py-6 text-center">Loading…</p>}

        {!loading && groups.length === 0 && (
          <div className="py-10 text-center">
            <RotateCcw className="w-8 h-8 text-[#c7d0dd] mx-auto mb-2" />
            <p className="text-sm font-semibold text-[#4a5568]">No carry-forward tasks</p>
            <p className="text-xs text-[#8896a9] mt-1">Nothing has been carried forward to you.</p>
          </div>
        )}

        {groups.map((g) => {
          const allOn = g.items.every((i) => selected.has(i.subtaskId));
          const chosenCount = g.items.filter((i) => selected.has(i.subtaskId)).length;
          const busy = busyClient === g.clientId;
          return (
            <div key={g.clientId} className="border border-[#e2e7f0] rounded-xl overflow-hidden bg-white">
              {/* Client header */}
              <div className="px-3 py-2.5 bg-[#f8fafc] border-b border-[#e2e7f0] flex items-center justify-between gap-2">
                <p className="text-sm font-bold text-[#0f1829] truncate flex items-center gap-1.5 min-w-0">
                  <Building2 className="w-3.5 h-3.5 text-[#8896a9] flex-shrink-0" />
                  <span className="truncate">{g.clientName}</span>
                  <span className="font-normal text-[#8896a9] flex-shrink-0">({g.clientCode}) · {g.items.length}</span>
                </p>
                <button
                  type="button"
                  onClick={() => toggleClientAll(g.items)}
                  className="text-[11px] font-semibold text-[#25488e] hover:underline flex-shrink-0"
                >
                  {allOn ? "Clear" : "Select All"}
                </button>
              </div>

              {/* Tasks */}
              <div className="divide-y divide-[#f1f4f9]">
                {g.items.map((item) => {
                  const checked = selected.has(item.subtaskId);
                  return (
                    <label
                      key={item.subtaskId}
                      className={cn(
                        "flex items-start gap-3 p-3 cursor-pointer transition-colors",
                        checked ? "bg-[#eef2fb]" : "hover:bg-[#f8fafc]"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOne(item.subtaskId)}
                        className="w-4 h-4 mt-0.5 accent-[#25488e] flex-shrink-0"
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-[#0f1829] break-words">{item.subtaskTitle}</p>
                            <p className="text-xs text-[#8896a9] truncate">{item.mainTask}</p>
                          </div>
                          <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md bg-orange-50 text-[#ff944d] border border-orange-200">
                            Carry Forward
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#8896a9]">
                          <span className="flex items-center gap-1"><User className="w-3 h-3" />{item.executiveName}</span>
                          <span className="flex items-center gap-1">
                            <CalendarDays className="w-3 h-3" />
                            {item.visitNumber} · {fmt(item.currentScheduledDate)}
                          </span>
                          {item.originalVisitNumber && (
                            <span>From {item.originalVisitNumber} · {fmt(item.originalDate)}</span>
                          )}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>

              {/* One destination date per client */}
              <div className="flex flex-wrap items-center gap-2 p-3 border-t border-[#e2e7f0] bg-[#f8fafc]">
                <span className="text-[11px] font-semibold text-[#4a5568]">{chosenCount} selected</span>
                <input
                  type="date"
                  value={dateByClient[g.clientId] ?? ""}
                  onChange={(e) => setDateByClient((p) => ({ ...p, [g.clientId]: e.target.value }))}
                  aria-label={`Destination date for ${g.clientName}`}
                  className="flex-1 min-w-[150px] border border-[#e2e7f0] rounded-lg px-3 py-2 text-sm text-[#0f1829] bg-white focus:outline-none focus:ring-2 focus:ring-[#25488e]/30"
                />
                <button
                  type="button"
                  onClick={() => reschedule(g.clientId, g.items)}
                  disabled={busy || chosenCount === 0 || !dateByClient[g.clientId]}
                  className="px-4 py-2 rounded-lg bg-[#25488e] hover:bg-[#1e3a72] text-white text-sm font-semibold transition-colors press-effect disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {busy ? "Saving…" : "Reschedule"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
