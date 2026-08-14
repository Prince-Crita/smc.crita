"use client";
import { cn } from "@/lib/utils/utils";

type BadgeVariant = "pending" | "inprogress" | "closed" | "active" | "inactive" | "success" | "warning" | "danger" | "default" | "missed";

const variantStyles: Record<BadgeVariant, string> = {
  pending:    "bg-amber-50   text-amber-700   border-amber-200",
  inprogress: "bg-blue-50    text-blue-700    border-blue-200",
  closed:     "bg-green-50   text-green-700   border-green-200",
  active:     "bg-green-50   text-green-700   border-green-200",
  inactive:   "bg-[#f1f4f9] text-[#8896a9]   border-[#e2e7f0]",
  success:    "bg-green-50   text-green-700   border-green-200",
  warning:    "bg-orange-50  text-orange-700  border-orange-200",
  danger:     "bg-red-50     text-red-700     border-red-200",
  missed:     "bg-[#fff0f6]  text-[#800040]   border-[#ffadd1]",
  default:    "bg-[#f1f4f9] text-[#4a5568]   border-[#e2e7f0]",
};

export function Badge({
  variant = "default",
  children,
  className,
}: {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn(
      "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border",
      variantStyles[variant],
      className
    )}>
      {children}
    </span>
  );
}

/**
 * ProgressBadge
 * -------------------------------------------------------------------------
 * Shows "<status> · <progress>%".
 *
 * `displayStatus` (the value produced by lib/utils/visit-status) MUST be
 * passed whenever it is available. Deriving the status from the percentage
 * alone — which is all this component used to do — mislabels the two cases
 * the visit-status helper exists to handle:
 *   • a visit formally CLOSED at e.g. 83% rendered "In Progress · 83%"
 *   • a visit closed with zero completed subtasks rendered "Pending · 0%"
 * That is the "completed visits still show as Pending" report. The
 * percentage-only path below is kept only as a fallback for callers that
 * genuinely have no status to hand.
 */
export function ProgressBadge({
  progress,
  displayStatus,
}: {
  progress: number;
  displayStatus?: "PENDING" | "IN_PROGRESS" | "CLOSED";
}) {
  // The fallback can never infer "Closed" from the percentage: only the
  // explicit Close Visit action closes a visit, so a visit at 100% that has
  // not been closed is still In Progress. Inferring Closed here relabelled
  // fully-completed open visits as Closed wherever a caller had no status.
  const resolved =
    displayStatus ?? (progress === 0 ? "PENDING" : "IN_PROGRESS");

  const variant: BadgeVariant =
    resolved === "PENDING" ? "pending" : resolved === "CLOSED" ? "closed" : "inprogress";
  const label =
    resolved === "PENDING" ? "Pending" : resolved === "CLOSED" ? "Closed" : "In Progress";

  return (
    <Badge variant={variant}>
      {label} · {progress}%
    </Badge>
  );
}
