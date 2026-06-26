"use client";
import { cn } from "@/lib/utils/utils";

type BadgeVariant = "pending" | "inprogress" | "closed" | "active" | "inactive" | "success" | "warning" | "danger" | "default";

const variantStyles: Record<BadgeVariant, string> = {
  pending: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  inprogress: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  closed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  inactive: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  warning: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  danger: "bg-red-500/10 text-red-400 border-red-500/20",
  default: "bg-slate-700/50 text-slate-400 border-slate-600/50",
};

export function Badge({ variant = "default", children, className }: { variant?: BadgeVariant; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border", variantStyles[variant], className)}>
      {children}
    </span>
  );
}

export function ProgressBadge({ progress }: { progress: number }) {
  const variant: BadgeVariant = progress === 0 ? "pending" : progress === 100 ? "closed" : "inprogress";
  const label = progress === 0 ? "Pending" : progress === 100 ? "Closed" : "In Progress";
  return <Badge variant={variant}>{label} • {progress}%</Badge>;
}
