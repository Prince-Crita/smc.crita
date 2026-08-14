"use client";

/**
 * Super Admin → record inspector.
 *
 * Opens one record with everything needed to judge it: its own fields, the
 * relationships hanging off it, its change history, and — for an executive or
 * admin — their activity timeline (§10).
 *
 * Corrections are driven entirely by the server's field registry: the form is
 * built from `spec.correctable`, so the UI can never offer to write a field
 * the server would refuse. A read-only entity shows the reason it is
 * read-only instead of a form.
 */
import { useEffect, useState } from "react";
import { Loader2, Save, Info, History as HistoryIcon, Activity as ActivityIcon } from "lucide-react";
import toast from "react-hot-toast";
import { Modal } from "@/components/ui/Modal";
import { revalidateAll } from "@/lib/hooks/useLiveQuery";
import { Pill, fmtDateTime, humanAction } from "./shared";
import { AssignmentCorrector } from "./AssignmentCorrector";
import { cn } from "@/lib/utils/utils";

export interface CorrectableField {
  name: string; label: string; kind: "text" | "boolean" | "date" | "datetime" | "select";
  options?: string[]; help?: string; required?: boolean;
}
export interface EntitySpec {
  entity: string; label: string; entityType: string | null;
  correctable: CorrectableField[]; readOnlyReason?: string;
}

type Row = Record<string, unknown>;

const HIDDEN_KEYS = new Set(["id", "operations", "activity", "_count"]);

/** Turn camelCase into a readable label. */
const labelOf = (k: string) =>
  k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).replace(/ Id$/, " ID");

const isDateish = (k: string, v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && /At$|Date$/.test(k);

function renderValue(k: string, v: unknown): React.ReactNode {
  if (v === null || v === undefined || v === "") return <span className="text-[#c7d0dd]">—</span>;
  if (typeof v === "boolean") return <Pill tone={v ? "good" : "neutral"}>{v ? "Yes" : "No"}</Pill>;
  if (isDateish(k, v)) return fmtDateTime(v as string);
  if (Array.isArray(v)) return v.length === 0 ? <span className="text-[#c7d0dd]">—</span> : `${v.length} item(s)`;
  if (typeof v === "object") {
    const o = v as Row;
    return (o.name as string) ?? (o.visitNumber as string) ?? JSON.stringify(o);
  }
  return String(v);
}

export function RecordInspector({
  entity, recordId, onClose,
}: { entity: string; recordId: string; onClose: () => void }) {
  const [record, setRecord] = useState<Row | null>(null);
  const [spec, setSpec] = useState<EntitySpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [patch, setPatch] = useState<Record<string, unknown>>({});
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  // Bumped to reload after a correction; the fetch lives in the effect so no
  // state is written before the first await (which would cost a cascading
  // render on every open).
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(
          `/api/super-admin/records?entity=${encodeURIComponent(entity)}&id=${encodeURIComponent(recordId)}`,
          { signal: controller.signal }
        );
        if (controller.signal.aborted) return;
        if (res.status === 404) { setNotFound(true); return; }
        if (!res.ok) { toast.error("Could not load this record."); return; }
        const j = await res.json() as { record: Row; spec: EntitySpec };
        if (controller.signal.aborted) return;
        setRecord(j.record);
        setSpec(j.spec);
        setPatch({});
      } catch {
        /* aborted on unmount / re-open — nothing to report */
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [entity, recordId, reloadToken]);

  const scalars = record
    ? Object.entries(record).filter(
        ([k, v]) => !HIDDEN_KEYS.has(k) && (v === null || typeof v !== "object" || !Array.isArray(v))
      )
    : [];
  const collections = record
    ? Object.entries(record).filter(([k, v]) => Array.isArray(v) && !HIDDEN_KEYS.has(k) && (v as unknown[]).length > 0)
    : [];
  const operations = (record?.operations as Row[] | undefined) ?? [];
  const activity = (record?.activity as Row[] | undefined) ?? [];

  const setField = (name: string, value: unknown) => setPatch((p) => ({ ...p, [name]: value }));

  const save = async () => {
    if (Object.keys(patch).length === 0) { toast.error("Change a field first."); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/super-admin/records", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity, id: recordId, patch, reason: reason.trim() || undefined }),
      });
      const j = await res.json().catch(() => null) as { error?: string; changed?: string[] } | null;
      if (!res.ok) { toast.error(j?.error ?? `Correction failed (${res.status})`); return; }
      toast.success(`Corrected ${j?.changed?.join(", ") ?? "record"}. This can be undone from the Control Panel.`);
      setReason("");
      setLoading(true);
      setReloadToken((t) => t + 1);
      // Push the correction to every other mounted screen — admin lists,
      // calendars and executive views included — without a manual refresh
      // (§11). One-shot and mutation-driven: no polling is introduced.
      revalidateAll();
    } finally {
      setSaving(false);
    }
  };

  const currentValue = (f: CorrectableField): unknown =>
    f.name in patch ? patch[f.name] : record?.[f.name];

  return (
    <Modal isOpen title={spec ? `${spec.label.replace(/s$/, "")} details` : "Record"} onClose={onClose} size="xl" fullScreenOnMobile>
      <div className="p-4 space-y-4">
        {loading && (
          <p className="py-10 text-center text-sm text-[#8896a9] flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading record…
          </p>
        )}

        {notFound && (
          <p className="py-10 text-center text-sm text-[#8896a9]">This record no longer exists.</p>
        )}

        {record && !loading && (
          <>
            {/* Fields */}
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wide text-[#8896a9] mb-2">Record</h3>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 bg-[#f8fafc] border border-[#e2e7f0] rounded-xl p-3">
                {scalars.map(([k, v]) => (
                  <div key={k} className="min-w-0 flex items-baseline gap-2">
                    <dt className="text-[11px] font-semibold text-[#8896a9] flex-shrink-0">{labelOf(k)}</dt>
                    <dd className="text-sm text-[#0f1829] break-words min-w-0">{renderValue(k, v)}</dd>
                  </div>
                ))}
                <div className="min-w-0 flex items-baseline gap-2 sm:col-span-2">
                  <dt className="text-[11px] font-semibold text-[#8896a9] flex-shrink-0">Entity ID</dt>
                  <dd className="text-[11px] font-mono text-[#4a5568] break-all">{recordId}</dd>
                </div>
              </dl>
            </section>

            {/* Relationships */}
            {collections.map(([k, v]) => (
              <section key={k}>
                <h3 className="text-xs font-bold uppercase tracking-wide text-[#8896a9] mb-2">
                  {labelOf(k)} ({(v as unknown[]).length})
                </h3>
                <ul className="border border-[#e2e7f0] rounded-xl divide-y divide-[#f1f4f9] overflow-hidden max-h-56 overflow-y-auto overscroll-contain">
                  {(v as Row[]).map((item, i) => (
                    <li key={(item.id as string) ?? i} className="px-3 py-2 text-sm text-[#0f1829]">
                      <RelationRow item={item} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            {/* Activity timeline (§10) */}
            {activity.length > 0 && (
              <section>
                <h3 className="text-xs font-bold uppercase tracking-wide text-[#8896a9] mb-2 flex items-center gap-1.5">
                  <ActivityIcon className="w-3.5 h-3.5" /> Activity timeline ({activity.length})
                </h3>
                <ul className="border border-[#e2e7f0] rounded-xl divide-y divide-[#f1f4f9] overflow-hidden max-h-72 overflow-y-auto overscroll-contain">
                  {activity.map((a, i) => (
                    <li key={(a.id as string) ?? i} className="px-3 py-2">
                      <p className="text-sm font-semibold text-[#0f1829]">{humanAction(String(a.action))}</p>
                      <p className="text-[11px] text-[#8896a9]">
                        {fmtDateTime(a.createdAt as string)}
                        {(a.visit as Row | null) ? ` · ${(a.visit as Row).visitNumber}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Change history (§4) */}
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wide text-[#8896a9] mb-2 flex items-center gap-1.5">
                <HistoryIcon className="w-3.5 h-3.5" /> Change history ({operations.length})
              </h3>
              {operations.length === 0 ? (
                <p className="text-sm text-[#8896a9] border border-[#e2e7f0] rounded-xl px-3 py-4 text-center">
                  No recorded changes for this record.
                </p>
              ) : (
                <ul className="border border-[#e2e7f0] rounded-xl divide-y divide-[#f1f4f9] overflow-hidden max-h-56 overflow-y-auto overscroll-contain">
                  {operations.map((op, i) => (
                    <li key={(op.id as string) ?? i} className="px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm text-[#0f1829] break-words min-w-0">{String(op.summary)}</p>
                        {op.undoneAt ? <Pill tone="good">Undone</Pill>
                          : op.isReversible ? <Pill tone="primary">Reversible</Pill>
                          : <Pill tone="danger">Not reversible</Pill>}
                      </div>
                      <p className="text-[11px] text-[#8896a9]">
                        {(op.user as Row)?.name as string} · {fmtDateTime(op.createdAt as string)}
                      </p>
                      {op.reason ? <p className="text-[11px] text-[#4a5568] italic">Reason: {String(op.reason)}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Solo/Team, lead and members — visits only (§2) */}
            {entity === "visits" && record.executive ? (
              <AssignmentCorrector
                visitId={recordId}
                currentType={(record.visitType as "SOLO" | "TEAM") ?? "SOLO"}
                currentLeadId={((record.executive as Row)?.id as string) ?? ""}
                currentMemberIds={((record.assignments as Row[]) ?? [])
                  .filter((a) => a.role !== "LEAD")
                  .map((a) => (a.executive as Row).id as string)}
                onDone={() => { setLoading(true); setReloadToken((t) => t + 1); }}
              />
            ) : null}

            {/* Correction */}
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wide text-[#8896a9] mb-2">Correct</h3>
              {!spec?.correctable.length ? (
                <p className="text-sm text-[#4a5568] bg-[#f8fafc] border border-[#e2e7f0] rounded-xl px-3 py-3 flex gap-2">
                  <Info className="w-4 h-4 text-[#8896a9] flex-shrink-0 mt-0.5" />
                  <span>{spec?.readOnlyReason ?? "This record is read-only here."}</span>
                </p>
              ) : (
                <div className="border border-[#e2e7f0] rounded-xl p-3 space-y-3">
                  {spec.correctable.map((f) => (
                    <div key={f.name}>
                      <label className="block text-[11px] font-semibold text-[#4a5568] mb-1" htmlFor={`f-${f.name}`}>
                        {f.label}
                      </label>
                      {f.kind === "boolean" ? (
                        <label className="flex items-center gap-2 text-sm text-[#0f1829]">
                          <input
                            id={`f-${f.name}`}
                            type="checkbox"
                            checked={!!currentValue(f)}
                            onChange={(e) => setField(f.name, e.target.checked)}
                            className="w-4 h-4 accent-[#25488e]"
                          />
                          {f.label}
                        </label>
                      ) : f.kind === "select" ? (
                        <select
                          id={`f-${f.name}`}
                          value={String(currentValue(f) ?? "")}
                          onChange={(e) => setField(f.name, e.target.value)}
                          className="w-full border border-[#e2e7f0] rounded-lg px-3 py-2 text-sm bg-white text-[#0f1829] focus:outline-none focus:ring-2 focus:ring-[#25488e]/30"
                        >
                          {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input
                          id={`f-${f.name}`}
                          type={f.kind === "date" ? "date" : f.kind === "datetime" ? "datetime-local" : "text"}
                          value={
                            f.kind === "date"
                              ? String(currentValue(f) ?? "").slice(0, 10)
                              : f.kind === "datetime"
                                // datetime-local wants YYYY-MM-DDTHH:mm with no
                                // zone suffix; the value arrives as an ISO string.
                                ? String(currentValue(f) ?? "").slice(0, 16)
                                : String(currentValue(f) ?? "")
                          }
                          onChange={(e) => setField(f.name, e.target.value)}
                          className="w-full border border-[#e2e7f0] rounded-lg px-3 py-2 text-sm bg-white text-[#0f1829] focus:outline-none focus:ring-2 focus:ring-[#25488e]/30"
                        />
                      )}
                      {f.help && <p className="text-[11px] text-[#8896a9] mt-1">{f.help}</p>}
                    </div>
                  ))}

                  <div>
                    <label className="block text-[11px] font-semibold text-[#4a5568] mb-1" htmlFor="correction-reason">
                      Reason (optional, recorded in the audit log)
                    </label>
                    <input
                      id="correction-reason"
                      type="text"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="e.g. wrong date entered by admin"
                      className="w-full border border-[#e2e7f0] rounded-lg px-3 py-2 text-sm bg-white text-[#0f1829] focus:outline-none focus:ring-2 focus:ring-[#25488e]/30"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-[11px] text-[#8896a9]">
                      Recorded in the audit log and reversible from the Control Panel.
                    </p>
                    <button
                      type="button"
                      onClick={save}
                      disabled={saving || Object.keys(patch).length === 0}
                      className={cn(
                        "px-4 py-2 rounded-lg bg-[#25488e] hover:bg-[#1e3a72] text-white text-sm font-semibold",
                        "transition-colors press-effect disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                      )}
                    >
                      {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      {saving ? "Saving…" : "Apply correction"}
                    </button>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}

/** One related row — visits, tasks, subtasks, attendance and so on. */
function RelationRow({ item }: { item: Row }) {
  const title =
    (item.visitNumber as string) ??
    (item.title as string) ??
    (item.name as string) ??
    ((item.executive as Row)?.name as string) ??
    (item.action ? humanAction(String(item.action)) : null) ??
    (item.taskType as string) ??
    "—";

  const bits: string[] = [];
  if (item.status) bits.push(String(item.status));
  if (item.role) bits.push(String(item.role));
  if ((item.client as Row)?.name) bits.push(String((item.client as Row).name));
  if ((item.executive as Row)?.name && title !== (item.executive as Row).name) {
    bits.push(String((item.executive as Row).name));
  }
  if (item.scheduledDate) bits.push(fmtDateTime(item.scheduledDate as string));
  if (item.date) bits.push(fmtDateTime(item.date as string));
  if (item.createdAt && !item.scheduledDate && !item.date) bits.push(fmtDateTime(item.createdAt as string));
  if (typeof item.isCompleted === "boolean") bits.push(item.isCompleted ? "completed" : "pending");
  if (item.reason) bits.push(String(item.reason));

  return (
    <div className="min-w-0 flex items-start justify-between gap-2">
      <span className="min-w-0">
        <span className="block font-semibold text-[#0f1829] break-words">{title}</span>
        {bits.length > 0 && <span className="block text-[11px] text-[#8896a9] break-words">{bits.join(" · ")}</span>}
      </span>
      {item.isCarriedForward ? <Pill tone="warn">CF</Pill> : null}
    </div>
  );
}
