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

export function ProgressBadge({ progress }: { progress: number }) {
  const variant: BadgeVariant =
    progress === 0 ? "pending" : progress === 100 ? "closed" : "inprogress";
  const label =
    progress === 0 ? "Pending" : progress === 100 ? "Closed" : "In Progress";
  return (
    <Badge variant={variant}>
      {label} · {progress}%
    </Badge>
  );
}
