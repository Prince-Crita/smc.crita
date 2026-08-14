"use client";

/**
 * Super Admin → Records (§3, §7, §10).
 *
 * One safe management view over every operational entity: search, filters,
 * date ranges and pagination, all applied server-side, with a per-record
 * inspector for relationships, history and corrections.
 *
 * Rows are rendered as a responsive list rather than a wide table, so nothing
 * overflows horizontally on a phone (§15). Paging is mandatory — the client
 * never receives a whole table to filter locally (§16).
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Database, Search, ChevronLeft, ChevronRight, X, Filter } from "lucide-react";
import { useLiveQuery, fetchJSON } from "@/lib/hooks/useLiveQuery";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { RecordInspector, type EntitySpec } from "@/components/super-admin/RecordInspector";
import { Panel, Pill, AccessDenied, fmtDate, fmtDateTime, humanAction } from "@/components/super-admin/shared";
import { cn } from "@/lib/utils/utils";

type Row = Record<string, unknown>;

interface Payload {
  entity: string;
  spec: EntitySpec & { statuses?: string[] };
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

const ENTITIES: { key: string; label: string }[] = [
  { key: "users", label: "Users" },
  { key: "clients", label: "Clients" },
  { key: "visits", label: "Visits" },
  { key: "tasks", label: "Tasks" },
  { key: "subtasks", label: "Subtasks" },
  { key: "carry-forward", label: "Carry Forward" },
  { key: "attendance", label: "Attendance" },
  { key: "leaves", label: "Leave" },
  { key: "assignments", label: "Assignments" },
  { key: "activity", label: "Activity" },
];

const DATE_ENTITIES = new Set(["visits", "attendance", "leaves", "activity"]);

export function RecordsClient() {
  const router = useRouter();
  const params = useSearchParams();

  const [entity, setEntity] = useState(params.get("entity") ?? "visits");
  const [q, setQ] = useState(params.get("q") ?? "");
  const [debouncedQ, setDebouncedQ] = useState(q);
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(params.get("id"));

  // Debounce the text box so typing does not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  // Any filter change returns to the first page — otherwise a narrowed result
  // set can land on a page that no longer exists. Done in the setters rather
  // than an effect, so changing a filter is one render, not two.
  const changeEntity = (next: string) => { setEntity(next); setStatus(""); setPage(1); };
  const changeQ = (next: string) => { setQ(next); setPage(1); };
  const changeStatus = (next: string) => { setStatus(next); setPage(1); };
  const changeFrom = (next: string) => { setFrom(next); setPage(1); };
  const changeTo = (next: string) => { setTo(next); setPage(1); };

  const query = new URLSearchParams({ entity, page: String(page), pageSize: "25" });
  if (debouncedQ.trim()) query.set("q", debouncedQ.trim());
  if (status) query.set("status", status);
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  const url = `/api/super-admin/records?${query.toString()}`;

  const { data, loading, error } = useLiveQuery(
    useCallback(() => fetchJSON<Payload>(url), [url])
  );

  if (error && String(error).includes("403")) return <AccessDenied title="Records" />;

  const spec = data?.spec;
  const statuses = spec?.statuses ?? [];

  const openRecord = (id: string) => {
    setOpenId(id);
    // Keep the URL shareable without a navigation/refresh.
    const next = new URLSearchParams({ entity, id });
    router.replace(`/admin/records?${next.toString()}`, { scroll: false });
  };
  const closeRecord = () => {
    setOpenId(null);
    router.replace(`/admin/records?entity=${entity}`, { scroll: false });
  };

  const clearFilters = () => { setQ(""); setStatus(""); setFrom(""); setTo(""); setPage(1); };
  const hasFilters = !!(q || status || from || to);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-[#0f1829] flex items-center gap-2">
          <Database className="w-6 h-6 text-[#25488e]" /> Records
        </h1>
        <p className="text-[#8896a9] text-sm mt-1">
          Inspect and correct operational records. Every correction is audited and reversible.
        </p>
      </div>

      {/* Entity tabs — scrollable strip, never overflowing the page */}
      <div className="-mx-1 px-1 overflow-x-auto overscroll-x-contain">
        <div role="tablist" aria-label="Record type" className="flex gap-1.5 min-w-max pb-1">
          {ENTITIES.map((e) => (
            <button
              key={e.key}
              role="tab"
              aria-selected={entity === e.key}
              onClick={() => changeEntity(e.key)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors press-effect border",
                entity === e.key
                  ? "bg-[#25488e] text-white border-[#25488e]"
                  : "bg-white text-[#4a5568] border-[#e2e7f0] hover:bg-[#f1f4f9]"
              )}
            >
              {e.label}
            </button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-[#e2e7f0] rounded-xl p-3 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8896a9] pointer-events-none" />
          <input
            type="search"
            value={q}
            onChange={(e) => changeQ(e.target.value)}
            placeholder="Search…"
            aria-label="Search records"
            className="w-full pl-9 pr-3 py-2 border border-[#e2e7f0] rounded-lg text-sm bg-white text-[#0f1829] focus:outline-none focus:ring-2 focus:ring-[#25488e]/30"
          />
        </div>

        {statuses.length > 0 && (
          <select
            value={status}
            onChange={(e) => changeStatus(e.target.value)}
            aria-label="Status filter"
            className="border border-[#e2e7f0] rounded-lg px-3 py-2 text-sm bg-white text-[#0f1829] focus:outline-none focus:ring-2 focus:ring-[#25488e]/30"
          >
            <option value="">All statuses</option>
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}

        {DATE_ENTITIES.has(entity) && (
          <>
            <input
              type="date" value={from} onChange={(e) => changeFrom(e.target.value)} aria-label="From date"
              className="border border-[#e2e7f0] rounded-lg px-2.5 py-2 text-sm bg-white text-[#0f1829] focus:outline-none focus:ring-2 focus:ring-[#25488e]/30"
            />
            <input
              type="date" value={to} onChange={(e) => changeTo(e.target.value)} aria-label="To date"
              className="border border-[#e2e7f0] rounded-lg px-2.5 py-2 text-sm bg-white text-[#0f1829] focus:outline-none focus:ring-2 focus:ring-[#25488e]/30"
            />
          </>
        )}

        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="px-3 py-2 rounded-lg border border-[#e2e7f0] text-[#4a5568] text-xs font-semibold hover:bg-[#f1f4f9] transition-colors flex items-center gap-1"
          >
            <X className="w-3 h-3" /> Clear
          </button>
        )}
      </div>

      <Panel
        title={spec?.label ?? "Records"}
        icon={Filter}
        count={data?.total}
        actions={
          data && data.pages > 1 ? (
            <span className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                aria-label="Previous page"
                className="p-1.5 rounded-lg border border-[#e2e7f0] text-[#4a5568] hover:bg-[#f1f4f9] disabled:opacity-40 transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-[11px] text-[#8896a9] tabular-nums">{data.page} / {data.pages}</span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
                disabled={page >= data.pages}
                aria-label="Next page"
                className="p-1.5 rounded-lg border border-[#e2e7f0] text-[#4a5568] hover:bg-[#f1f4f9] disabled:opacity-40 transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </span>
          ) : null
        }
      >
        {loading && !data ? (
          <div className="p-4"><SkeletonTable rows={6} /></div>
        ) : !data || data.rows.length === 0 ? (
          <p className="px-4 py-10 text-sm text-[#8896a9] text-center">
            No {spec?.label.toLowerCase() ?? "records"} match these filters.
          </p>
        ) : (
          <ul className="divide-y divide-[#f1f4f9]">
            {data.rows.map((row, i) => (
              <li key={(row.id as string) ?? i}>
                <button
                  type="button"
                  onClick={() => openRecord(row.id as string)}
                  className="w-full text-left px-4 py-3 hover:bg-[#f8fafc] transition-colors focus:bg-[#eef2fb] focus:outline-none"
                >
                  <RecordRow entity={entity} row={row} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {data && data.rows.length > 0 && (
          <p className="px-4 py-2.5 border-t border-[#f1f4f9] text-[11px] text-[#8896a9]">
            Showing {(data.page - 1) * data.pageSize + 1}–
            {Math.min(data.page * data.pageSize, data.total)} of {data.total}
          </p>
        )}
      </Panel>

      {openId && <RecordInspector entity={entity} recordId={openId} onClose={closeRecord} />}
    </div>
  );
}

/** Row summary per entity — title, supporting detail, and a status pill. */
function RecordRow({ entity, row }: { entity: string; row: Row }) {
  const o = (k: string) => row[k] as Row | null;
  let title = "—";
  let detail = "";
  let pill: { text: string; tone: "neutral" | "primary" | "warn" | "danger" | "good" } | null = null;

  switch (entity) {
    case "users":
      title = String(row.name);
      detail = [row.email, row.phone, `${(row._count as Row)?.assignedVisits ?? 0} visit(s)`]
        .filter(Boolean).join(" · ");
      pill = row.isActive ? { text: String(row.role), tone: "primary" } : { text: "Inactive", tone: "warn" };
      break;
    case "clients":
      title = `${row.name} (${row.code})`;
      detail = [o("assignedExec")?.name, row.contactPerson, `${(row._count as Row)?.visits ?? 0} visit(s)`]
        .filter(Boolean).join(" · ");
      pill = row.isArchived ? { text: "Archived", tone: "warn" } : { text: "Active", tone: "good" };
      break;
    case "visits":
      title = `${row.visitNumber} · ${o("client")?.name ?? "—"}`;
      detail = [
        fmtDate(row.scheduledDate as string),
        o("executive")?.name,
        row.visitType,
        `${(row._count as Row)?.tasks ?? 0} task(s)`,
      ].filter(Boolean).join(" · ");
      pill = { text: String(row.status), tone: row.status === "CLOSED" ? "good" : row.status === "OPEN" ? "primary" : "neutral" };
      break;
    case "tasks":
      title = String(row.title);
      detail = [
        (o("visit") as Row)?.visitNumber,
        ((o("visit") as Row)?.client as Row)?.name,
        `${(row._count as Row)?.subtasks ?? 0} subtask(s)`,
      ].filter(Boolean).join(" · ");
      pill = { text: String(row.status), tone: row.status === "COMPLETED" ? "good" : "neutral" };
      break;
    case "subtasks":
    case "carry-forward": {
      const visit = (o("task") as Row)?.visit as Row | undefined;
      title = String(row.title);
      detail = [visit?.visitNumber, (visit?.client as Row)?.name, (visit?.executive as Row)?.name]
        .filter(Boolean).join(" · ");
      pill = row.isCompleted
        ? { text: "Completed", tone: "good" }
        : row.isCarriedForward
          ? { text: "Carried", tone: "warn" }
          : row.carryForwardRejectedAt
            ? { text: "Rejected", tone: "danger" }
            : row.carryForwardRequestedAt
              ? { text: "Awaiting approval", tone: "warn" }
              : { text: "Pending", tone: "neutral" };
      break;
    }
    case "attendance":
      title = String(o("executive")?.name ?? "—");
      detail = [
        fmtDate(row.date as string),
        `in ${fmtDateTime(row.punchIn as string).split(", ").pop()}`,
        row.punchOut ? `out ${fmtDateTime(row.punchOut as string).split(", ").pop()}` : "still in",
        row.notes ? `note: ${String(row.notes).slice(0, 40)}` : "",
      ].filter(Boolean).join(" · ");
      pill = row.isLate ? { text: "Late", tone: "warn" } : null;
      break;
    case "leaves":
      title = String(o("executive")?.name ?? "—");
      detail = [fmtDate(row.date as string), String(row.reason).slice(0, 60)].filter(Boolean).join(" · ");
      pill = {
        text: String(row.status),
        tone: row.status === "APPROVED" ? "good" : row.status === "REJECTED" ? "danger" : "warn",
      };
      break;
    case "assignments": {
      const visit = o("visit");
      title = `${o("executive")?.name ?? "—"} — ${visit?.visitNumber ?? "—"}`;
      detail = [(visit?.client as Row)?.name, visit?.visitType, fmtDate(visit?.scheduledDate as string)]
        .filter(Boolean).join(" · ");
      pill = { text: String(row.role), tone: row.role === "LEAD" ? "primary" : "neutral" };
      break;
    }
    case "activity":
      title = humanAction(String(row.action));
      detail = [o("user")?.name, fmtDateTime(row.createdAt as string), o("visit")?.visitNumber]
        .filter(Boolean).join(" · ");
      pill = { text: String(o("user")?.role ?? ""), tone: "neutral" };
      break;
  }

  return (
    <div className="flex items-start justify-between gap-3 min-w-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[#0f1829] break-words">{title}</p>
        {detail && <p className="text-[11px] text-[#8896a9] break-words mt-0.5">{detail}</p>}
      </div>
      {pill && <Pill tone={pill.tone}>{pill.text}</Pill>}
    </div>
  );
}
