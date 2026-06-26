"use client";
import { cn } from "@/lib/utils/utils";

export function ProgressBar({ value, size = "md", showLabel = false, className }: { value: number; size?: "sm" | "md"; showLabel?: boolean; className?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  const color = pct === 100 ? "bg-emerald-500" : pct >= 67 ? "bg-blue-400" : pct >= 34 ? "bg-blue-500" : pct > 0 ? "bg-amber-500" : "bg-slate-700";
  const height = size === "sm" ? "h-1.5" : "h-2";

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className={cn("flex-1 rounded-full bg-slate-700/60", height)}>
        <div className={cn("rounded-full transition-all duration-500", height, color)} style={{ width: `${pct}%` }} />
      </div>
      {showLabel && <span className="text-xs font-medium text-slate-400 w-8 text-right">{pct}%</span>}
    </div>
  );
}
