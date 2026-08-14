"use client";

/**
 * Small presentational pieces shared by the Super Admin screens.
 *
 * Deliberately built from the application's existing design language — the
 * same navy/slate palette, card treatment, rounded corners and spacing used
 * by the Admin pages — so the control panel reads as part of the product
 * rather than a bolted-on console. No existing component is modified.
 */
import Link from "next/link";
import { cn } from "@/lib/utils/utils";

/** A compact metric tile. Optionally a link, optionally a filter toggle. */
export function StatTile({
  label, value, hint, tone = "default", href, onClick, active,
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "default" | "primary" | "warn" | "danger" | "good";
  href?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const toneClass = {
    default: "text-[#0f1829]",
    primary: "text-[#25488e]",
    warn: "text-[#ff944d]",
    danger: "text-[#800040]",
    good: "text-green-700",
  }[tone];

  const body = (
    <>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8896a9] truncate">{label}</p>
      <p className={cn("text-2xl font-bold mt-1 leading-none", toneClass)}>{value}</p>
      {hint && <p className="text-[11px] text-[#8896a9] mt-1.5 truncate">{hint}</p>}
    </>
  );

  const base = cn(
    "bg-white border rounded-xl p-3.5 text-left transition-colors min-w-0",
    active ? "border-[#25488e] ring-2 ring-[#25488e]/20" : "border-[#e2e7f0]",
    (href || onClick) && "hover:border-[#25488e]/50 hover:bg-[#f8fafc] press-effect"
  );

  if (href) return <Link href={href} className={base}>{body}</Link>;
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={!!active} className={base}>
        {body}
      </button>
    );
  }
  return <div className={base}>{body}</div>;
}

/** Section shell: title bar + body, matching the admin card treatment. */
export function Panel({
  title, icon: Icon, count, actions, children, className,
}: {
  title: string;
  icon?: React.ElementType;
  count?: number;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("bg-white border border-[#e2e7f0] rounded-xl shadow-sm overflow-hidden", className)}>
      <div className="px-4 py-3 border-b border-[#f1f4f9] flex items-center gap-2 flex-wrap">
        {Icon && <Icon className="w-4 h-4 text-[#25488e] flex-shrink-0" />}
        <h2 className="text-sm font-bold text-[#0f1829]">{title}</h2>
        {typeof count === "number" && <span className="text-xs text-[#8896a9]">({count})</span>}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** Severity / status pill. */
export function Pill({
  children, tone = "neutral", className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "primary" | "warn" | "danger" | "good";
  className?: string;
}) {
  const tones = {
    neutral: "bg-[#f1f4f9] text-[#8896a9] border-[#e2e7f0]",
    primary: "bg-[#eef2fb] text-[#25488e] border-[#c9d7f0]",
    warn: "bg-orange-50 text-[#ff944d] border-orange-200",
    danger: "bg-red-50 text-[#800040] border-red-200",
    good: "bg-green-50 text-green-700 border-green-200",
  }[tone];
  return (
    <span className={cn(
      "inline-block flex-shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide border",
      tones, className
    )}>
      {children}
    </span>
  );
}

/** The "Super Admin only" state, shown when an API answers 403. */
export function AccessDenied({ title }: { title: string }) {
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-[#0f1829]">{title}</h1>
      <div className="bg-white border border-[#e2e7f0] rounded-xl p-8 text-center">
        <p className="text-sm font-bold text-[#0f1829]">Super Admin only</p>
        <p className="text-xs text-[#8896a9] mt-1">
          Your account does not have access to this area.
        </p>
      </div>
    </div>
  );
}

export const fmtDateTime = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }) : "—";

export const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/** Human label for an ACTION_LIKE_THIS constant. */
export const humanAction = (a: string) =>
  a.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
