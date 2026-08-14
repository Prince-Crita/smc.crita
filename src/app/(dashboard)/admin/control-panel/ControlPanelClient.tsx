"use client";

/**
 * Super Admin → Control Panel (§4, §5, §6).
 *
 * The audit trail and the recovery controls. Each entry shows who acted, what
 * entity changed, the previous and new values, any reason given, and whether
 * it can still be reversed — and, once reversed, who undid it and when.
 *
 * Reversibility is shown honestly. An operation recorded as not reversible is
 * labelled "Not reversible" and offers no button: the system never claims to
 * have restored something it cannot restore. An undone operation offers Redo,
 * which re-applies the same recorded values through the same whitelist.
 *
 * Access is enforced server-side by /api/super-admin/operations; this page
 * renders the denied state rather than relying on the nav hiding the link.
 */
import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ShieldCheck, RotateCcw, AlertCircle, Undo2, Redo2, ChevronDown,
  ChevronLeft, ChevronRight, Search,
} from "lucide-react";
import toast from "react-hot-toast";
import { cn } from "@/lib/utils/utils";
import { useLiveQuery, fetchJSON, revalidateAll } from "@/lib/hooks/useLiveQuery";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Pill, fmtDateTime } from "@/components/super-admin/shared";

interface Operation {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  reason: string | null;
  beforeJson: Record<string, unknown> | null;
  afterJson: Record<string, unknown> | null;
  isReversible: boolean;
  canUndo: boolean;
  canRedo: boolean;
  reversibility: string;
  undoneAt: string | null;
  createdAt: string;
  user: { id: string; name: string; role: string };
  undoneBy: { id: string; name: string } | null;
}

interface Payload {
  operations: Operation[];
  total: number;
  page: number;
  pages: number;
}

const ENTITY_ROUTE: Record<string, string> = {
  User: "users", Client: "clients", Visit: "visits", Task: "tasks", Subtask: "subtasks",
};

const fmtVal = (v: unknown) =>
  v === null || v === undefined || v === "" ? "—"
    : typeof v === "boolean" ? (v ? "yes" : "no")
    : Array.isArray(v) ? (v.length === 0 ? "none" : `${v.length} item(s)`)
    : typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? fmtDateTime(v)
    : String(v);

export function ControlPanelClient() {
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [confirmWindow, setConfirmWindow] = useState<15 | 30 | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [state, setState] = useState(params.get("state") ?? "");
  const [entityType, setEntityType] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [reason, setReason] = useState("");

  const query = new URLSearchParams({ page: String(page), pageSize: "25" });
  if (state) query.set("state", state);
  if (entityType) query.set("entityType", entityType);
  if (q.trim()) query.set("q", q.trim());
  const url = `/api/super-admin/operations?${query.toString()}`;

  const { data, loading, refresh } = useLiveQuery(
    useCallback(async () => {
      const res = await fetch(url);
      if (res.status === 403) { setDenied(true); return null; }
      setDenied(false);
      return fetchJSON<Payload>(url);
    }, [url])
  );
  const operations = data?.operations ?? [];

  const post = async (body: Record<string, unknown>, label: string) => {
    setBusy(true);
    try {
      const res = await fetch("/api/super-admin/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, reason: reason.trim() || undefined }),
      });
      const j = await res.json().catch(() => null) as
        | { error?: string; undone?: number; redone?: number; skipped?: number; errors?: string[] }
        | null;
      if (!res.ok) { toast.error(j?.error ?? `${label} failed`); return; }

      if (typeof j?.redone === "number") toast.success("Operation re-applied.");
      else if (typeof j?.undone === "number") {
        toast.success(
          `${j.undone} operation(s) undone` +
            (j.skipped ? ` · ${j.skipped} skipped (not reversible)` : "")
        );
      } else toast.success(`${label} done`);

      setReason("");
      await refresh();
      // Push the restored values to every other mounted screen (§11).
      revalidateAll();
    } finally {
      setBusy(false);
    }
  };

  if (denied) {
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-bold text-[#0f1829]">Control Panel</h1>
        <div className="bg-white border border-[#e2e7f0] rounded-xl p-8 text-center">
          <AlertCircle className="w-8 h-8 text-[#800040] mx-auto mb-3" />
          <p className="text-sm font-bold text-[#0f1829]">Super Admin only</p>
          <p className="text-xs text-[#8896a9] mt-1">
            Your account does not have access to the Super Admin control panel.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-[#0f1829] flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-[#25488e]" /> Control Panel
          </h1>
          <p className="text-[#8896a9] text-sm mt-1">
            Audit trail and recovery. Destructive actions are recorded but cannot be undone.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => post({ scope: "last" }, "Undo last")}
            disabled={busy}
            className="px-3 py-2 rounded-lg border border-[#e2e7f0] text-[#4a5568] text-sm font-semibold hover:bg-[#f1f4f9] transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            <Undo2 className="w-3.5 h-3.5" /> Undo last
          </button>
          <button
            type="button" onClick={() => setConfirmWindow(15)} disabled={busy}
            className="px-3 py-2 rounded-lg border border-[#e2e7f0] text-[#4a5568] text-sm font-semibold hover:bg-[#f1f4f9] transition-colors disabled:opacity-50"
          >
            Undo last 15 min
          </button>
          <button
            type="button" onClick={() => setConfirmWindow(30)} disabled={busy}
            className="px-3 py-2 rounded-lg border border-[#e2e7f0] text-[#4a5568] text-sm font-semibold hover:bg-[#f1f4f9] transition-colors disabled:opacity-50"
          >
            Undo last 30 min
          </button>
        </div>
      </div>

      {/* Reason applies to the next recovery action taken from this page. */}
      <div className="bg-white border border-[#e2e7f0] rounded-xl p-3 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8896a9] pointer-events-none" />
          <input
            type="search" value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Search the audit trail…"
            aria-label="Search operations"
            className="w-full pl-9 pr-3 py-2 border border-[#e2e7f0] rounded-lg text-sm bg-white text-[#0f1829] focus:outline-none focus:ring-2 focus:ring-[#25488e]/30"
          />
        </div>
        <select
          value={state} onChange={(e) => { setState(e.target.value); setPage(1); }}
          aria-label="Reversibility filter"
          className="border border-[#e2e7f0] rounded-lg px-3 py-2 text-sm bg-white text-[#0f1829] focus:outline-none focus:ring-2 focus:ring-[#25488e]/30"
        >
          <option value="">All operations</option>
          <option value="reversible">Reversible</option>
          <option value="undone">Undone</option>
          <option value="irreversible">Not reversible</option>
        </select>
        <select
          value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }}
          aria-label="Entity filter"
          className="border border-[#e2e7f0] rounded-lg px-3 py-2 text-sm bg-white text-[#0f1829] focus:outline-none focus:ring-2 focus:ring-[#25488e]/30"
        >
          <option value="">All entities</option>
          {["Visit", "Client", "User", "Task", "Subtask"].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input
          type="text" value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for the next undo/redo (optional)"
          aria-label="Reason for recovery action"
          className="flex-1 min-w-[180px] border border-[#e2e7f0] rounded-lg px-3 py-2 text-sm bg-white text-[#0f1829] focus:outline-none focus:ring-2 focus:ring-[#25488e]/30"
        />
      </div>

      {loading && !data && <SkeletonCard />}

      <div className="bg-white border border-[#e2e7f0] rounded-xl overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-[#f1f4f9] flex items-center gap-2 flex-wrap">
          <RotateCcw className="w-4 h-4 text-[#25488e]" />
          <h2 className="text-sm font-bold text-[#0f1829]">Activity Log</h2>
          <span className="text-xs text-[#8896a9]">({data?.total ?? 0})</span>
          {data && data.pages > 1 && (
            <span className="ml-auto flex items-center gap-1.5">
              <button
                type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                aria-label="Previous page"
                className="p-1.5 rounded-lg border border-[#e2e7f0] text-[#4a5568] hover:bg-[#f1f4f9] disabled:opacity-40 transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-[11px] text-[#8896a9] tabular-nums">{data.page} / {data.pages}</span>
              <button
                type="button" onClick={() => setPage((p) => Math.min(data.pages, p + 1))} disabled={page >= data.pages}
                aria-label="Next page"
                className="p-1.5 rounded-lg border border-[#e2e7f0] text-[#4a5568] hover:bg-[#f1f4f9] disabled:opacity-40 transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </span>
          )}
        </div>

        {!loading && operations.length === 0 && (
          <p className="px-4 py-8 text-sm text-[#8896a9] text-center">
            No administrative activity matches these filters.
          </p>
        )}

        <div className="divide-y divide-[#f1f4f9]">
          {operations.map((op) => {
            const isOpen = expanded === op.id;
            const keys = [
              ...new Set([
                ...Object.keys(op.beforeJson ?? {}),
                ...Object.keys(op.afterJson ?? {}),
              ]),
            ].filter((k) => !k.startsWith("__"));
            const route = ENTITY_ROUTE[op.entityType];

            return (
              <div key={op.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#0f1829] break-words">{op.summary}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[#8896a9] mt-1">
                      <span>{op.user.name} ({op.user.role})</span>
                      <span>{fmtDateTime(op.createdAt)}</span>
                      <span className="font-mono">{op.action}</span>
                      {route && (
                        <Link
                          href={`/admin/records?entity=${route}&id=${op.entityId}`}
                          className="text-[#25488e] hover:underline font-semibold"
                        >
                          Open {op.entityType}
                        </Link>
                      )}
                      {op.undoneAt && (
                        <span className="text-green-700 font-semibold">
                          Undone by {op.undoneBy?.name ?? "—"} · {fmtDateTime(op.undoneAt)}
                        </span>
                      )}
                    </div>
                    {op.reason && (
                      <p className="text-[11px] text-[#4a5568] italic mt-0.5">Reason: {op.reason}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {keys.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : op.id)}
                        aria-expanded={isOpen}
                        aria-label={isOpen ? "Hide changes" : "Show changes"}
                        className="p-1.5 rounded-lg text-[#4a5568] hover:bg-[#f1f4f9] transition-colors"
                      >
                        <ChevronDown className={cn("w-4 h-4 transition-transform", isOpen && "rotate-180")} />
                      </button>
                    )}
                    {op.canUndo ? (
                      <button
                        type="button"
                        onClick={() => post({ operationId: op.id }, "Undo")}
                        disabled={busy}
                        className="px-3 py-1.5 rounded-lg bg-[#25488e] hover:bg-[#1e3a72] text-white text-xs font-bold transition-colors press-effect disabled:opacity-50 flex items-center gap-1"
                      >
                        <Undo2 className="w-3 h-3" /> Undo
                      </button>
                    ) : op.canRedo ? (
                      <button
                        type="button"
                        onClick={() => post({ redoOperationId: op.id }, "Redo")}
                        disabled={busy}
                        className="px-3 py-1.5 rounded-lg border border-[#25488e] text-[#25488e] hover:bg-[#eef2fb] text-xs font-bold transition-colors press-effect disabled:opacity-50 flex items-center gap-1"
                      >
                        <Redo2 className="w-3 h-3" /> Redo
                      </button>
                    ) : (
                      <Pill tone={op.undoneAt ? "good" : "danger"}>
                        {op.undoneAt ? "Undone" : "Not reversible"}
                      </Pill>
                    )}
                  </div>
                </div>

                {isOpen && keys.length > 0 && (
                  <div className="mt-2.5 border border-[#e2e7f0] rounded-lg overflow-hidden">
                    <div className="grid grid-cols-[1fr_1fr_1fr] gap-px bg-[#e2e7f0] text-[11px]">
                      <div className="bg-[#f8fafc] px-2.5 py-1.5 font-bold text-[#8896a9] uppercase tracking-wide">Field</div>
                      <div className="bg-[#f8fafc] px-2.5 py-1.5 font-bold text-[#8896a9] uppercase tracking-wide">Previous</div>
                      <div className="bg-[#f8fafc] px-2.5 py-1.5 font-bold text-[#8896a9] uppercase tracking-wide">New</div>
                      {keys.map((k) => (
                        <div key={k} className="contents">
                          <div className="bg-white px-2.5 py-1.5 font-semibold text-[#4a5568] break-words">{k}</div>
                          <div className="bg-white px-2.5 py-1.5 text-[#8896a9] break-words">{fmtVal(op.beforeJson?.[k])}</div>
                          <div className="bg-white px-2.5 py-1.5 text-[#0f1829] break-words">{fmtVal(op.afterJson?.[k])}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {confirmWindow !== null && (
        <ConfirmDialog
          isOpen
          title={`Undo the last ${confirmWindow} minutes?`}
          message={`Every reversible administrative action from the last ${confirmWindow} minutes will be restored to its previous state. Actions that cannot be safely reversed are skipped, not faked.`}
          confirmLabel="Undo"
          onConfirm={() => {
            const m = confirmWindow;
            setConfirmWindow(null);
            void post({ scope: "minutes", minutes: m }, `Undo ${m} min`);
          }}
          onCancel={() => setConfirmWindow(null)}
        />
      )}
    </div>
  );
}
