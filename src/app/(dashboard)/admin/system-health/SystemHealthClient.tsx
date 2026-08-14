"use client";

/**
 * Super Admin → Data Integrity (§8).
 *
 * A DIAGNOSTIC screen. Loading it changes nothing: each check explains what it
 * looked for, what it found and what to do about it. Where a correction is
 * genuinely safe and unambiguous the item offers one — and that correction
 * goes through the same audited, reversible records endpoint as any other, so
 * nothing is repaired silently.
 */
import { useCallback, useState } from "react";
import Link from "next/link";
import { HeartPulse, AlertTriangle, AlertCircle, Info, CheckCircle2, ChevronDown, Wrench } from "lucide-react";
import toast from "react-hot-toast";
import { useLiveQuery, fetchJSON, revalidateAll } from "@/lib/hooks/useLiveQuery";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { StatTile, Panel, Pill, AccessDenied } from "@/components/super-admin/shared";
import { cn } from "@/lib/utils/utils";

interface HealthItem {
  entity: string;
  id: string;
  label: string;
  detail: string;
  fix?: { patch: Record<string, unknown>; describe: string };
}
interface HealthCheck {
  key: string;
  title: string;
  severity: "critical" | "warning" | "info";
  explanation: string;
  guidance: string;
  count: number;
  items: HealthItem[];
}
interface Payload {
  checks: HealthCheck[];
  totals: { critical: number; warning: number; info: number; issues: number };
  generatedAt: string;
}

const SEVERITY = {
  critical: { tone: "danger" as const, icon: AlertCircle, label: "Critical" },
  warning: { tone: "warn" as const, icon: AlertTriangle, label: "Warning" },
  info: { tone: "primary" as const, icon: Info, label: "Info" },
};

export function SystemHealthClient() {
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ item: HealthItem; check: HealthCheck } | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, loading, error, refresh } = useLiveQuery(
    useCallback(() => fetchJSON<Payload>("/api/super-admin/health"), [])
  );

  if (error && String(error).includes("403")) return <AccessDenied title="Data Integrity" />;

  const applyFix = async (item: HealthItem) => {
    if (!item.fix) return;
    setBusy(true);
    try {
      const res = await fetch("/api/super-admin/records", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity: item.entity,
          id: item.id,
          patch: item.fix.patch,
          reason: `Data integrity correction: ${item.detail}`,
        }),
      });
      const j = await res.json().catch(() => null) as { error?: string } | null;
      if (!res.ok) { toast.error(j?.error ?? `Correction failed (${res.status})`); return; }
      toast.success("Corrected. This can be undone from the Control Panel.");
      await refresh();
      revalidateAll();
    } finally {
      setBusy(false);
    }
  };

  const checksWithIssues = data?.checks.filter((c) => c.count > 0) ?? [];
  const clean = data?.checks.filter((c) => c.count === 0) ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-[#0f1829] flex items-center gap-2">
          <HeartPulse className="w-6 h-6 text-[#25488e]" /> Data Integrity
        </h1>
        <p className="text-[#8896a9] text-sm mt-1">
          Diagnostics only — nothing is repaired automatically. Review a finding, then correct it deliberately.
        </p>
      </div>

      {loading && !data ? (
        <SkeletonCard />
      ) : !data ? null : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatTile label="Total findings" value={data.totals.issues} tone={data.totals.issues > 0 ? "warn" : "good"} />
            <StatTile label="Critical" value={data.totals.critical} tone={data.totals.critical > 0 ? "danger" : "default"} />
            <StatTile label="Warnings" value={data.totals.warning} tone={data.totals.warning > 0 ? "warn" : "default"} />
            <StatTile label="Informational" value={data.totals.info} />
          </div>

          {checksWithIssues.length === 0 && (
            <div className="bg-white border border-[#e2e7f0] rounded-xl p-8 text-center">
              <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-2" />
              <p className="text-sm font-bold text-[#0f1829]">No integrity problems detected</p>
              <p className="text-xs text-[#8896a9] mt-1">
                All {data.checks.length} checks passed.
              </p>
            </div>
          )}

          {checksWithIssues.map((check) => {
            const sev = SEVERITY[check.severity];
            const Icon = sev.icon;
            const expanded = open === check.key;
            return (
              <Panel
                key={check.key}
                title={check.title}
                icon={Icon}
                count={check.count}
                actions={
                  <span className="flex items-center gap-2">
                    <Pill tone={sev.tone}>{sev.label}</Pill>
                    <button
                      type="button"
                      onClick={() => setOpen(expanded ? null : check.key)}
                      aria-expanded={expanded}
                      className="p-1 rounded-lg text-[#4a5568] hover:bg-[#f1f4f9] transition-colors"
                      aria-label={expanded ? "Collapse" : "Expand"}
                    >
                      <ChevronDown className={cn("w-4 h-4 transition-transform", expanded && "rotate-180")} />
                    </button>
                  </span>
                }
              >
                <div className="px-4 py-3 space-y-1.5 border-b border-[#f1f4f9] bg-[#f8fafc]">
                  <p className="text-xs text-[#4a5568]"><span className="font-semibold">What this means:</span> {check.explanation}</p>
                  <p className="text-xs text-[#4a5568]"><span className="font-semibold">What to do:</span> {check.guidance}</p>
                </div>

                {expanded && (
                  <ul className="divide-y divide-[#f1f4f9] max-h-96 overflow-y-auto overscroll-contain">
                    {check.items.map((item) => (
                      <li key={`${item.entity}:${item.id}`} className="px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/admin/records?entity=${item.entity}&id=${item.id}`}
                            className="text-sm font-semibold text-[#0f1829] hover:text-[#25488e] break-words"
                          >
                            {item.label}
                          </Link>
                          <p className="text-[11px] text-[#8896a9] break-words mt-0.5">{item.detail}</p>
                        </div>
                        {item.fix && (
                          <button
                            type="button"
                            onClick={() => setConfirm({ item, check })}
                            disabled={busy}
                            className="px-3 py-1.5 rounded-lg border border-[#25488e] text-[#25488e] text-xs font-bold hover:bg-[#eef2fb] transition-colors press-effect disabled:opacity-50 flex items-center gap-1.5 flex-shrink-0"
                          >
                            <Wrench className="w-3 h-3" /> {item.fix.describe}
                          </button>
                        )}
                      </li>
                    ))}
                    {check.count > check.items.length && (
                      <li className="px-4 py-2.5 text-[11px] text-[#8896a9]">
                        Showing the first {check.items.length} of {check.count}.
                      </li>
                    )}
                  </ul>
                )}
              </Panel>
            );
          })}

          {clean.length > 0 && (
            <Panel title="Checks that passed" icon={CheckCircle2} count={clean.length}>
              <ul className="divide-y divide-[#f1f4f9]">
                {clean.map((c) => (
                  <li key={c.key} className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-[#0f1829] truncate">{c.title}</span>
                      <span className="block text-[11px] text-[#8896a9] break-words">{c.explanation}</span>
                    </span>
                    <Pill tone="good">Clear</Pill>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <p className="text-[11px] text-[#8896a9] text-center">
            Checked {new Date(data.generatedAt).toLocaleString("en-IN")}
          </p>
        </>
      )}

      {confirm && (
        <ConfirmDialog
          isOpen
          title={confirm.item.fix!.describe}
          message={
            <>
              <p>{confirm.item.label}</p>
              <p className="mt-1 text-[#8896a9]">{confirm.item.detail}</p>
              <p className="mt-2">
                This correction is recorded in the audit log and can be undone from the Control Panel.
              </p>
            </>
          }
          confirmLabel="Apply correction"
          onConfirm={() => { const i = confirm.item; setConfirm(null); void applyFix(i); }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
