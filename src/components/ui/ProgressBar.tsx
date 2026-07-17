"use client";
import { cn } from "@/lib/utils/utils";

/**
 * ProgressBar — Light enterprise theme
 *
 * Colors:
 *   0%:       empty track only
 *   1-33%:    brand-maroon (warning)
 *   34-66%:   amber
 *   67-99%:   brand-blue
 *   100%:     green (success)
 */
export function ProgressBar({
  value,
  size = "md",
  showLabel = false,
  className,
  variant = "brand",
}: {
  value: number;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
  variant?: "brand" | "maroon" | "orange";
}) {
  const pct = Math.max(0, Math.min(100, value));

  const trackH = size === "sm" ? "h-1.5" : size === "lg" ? "h-3" : "h-2";

  // Bar color by progress value
  const barColor =
    pct === 100
      ? "bg-green-500"
      : pct >= 67
      ? "bg-[#25488e]"
      : pct >= 34
      ? "bg-amber-500"
      : pct > 0
      ? "bg-[#800040]"
      : "bg-transparent";

  const overrideColor =
    variant === "maroon" ? "bg-[#800040]" :
    variant === "orange"  ? "bg-[#ff944d]" : null;

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className={cn("flex-1 rounded-full bg-[#e2e7f0]", trackH)}>
        <div
          className={cn("rounded-full transition-all duration-500", trackH, overrideColor ?? barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs font-semibold text-[#4a5568] w-9 text-right tabular-nums">
          {pct}%
        </span>
      )}
    </div>
  );
}
