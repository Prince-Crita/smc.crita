"use client";

import { cn } from "@/lib/utils/utils";

// ─── Base Skeleton ─────────────────────────────────────────────────────────────
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-xl skeleton-shimmer",
        className
      )}
      style={{
        background: "linear-gradient(90deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.8s ease-in-out infinite",
      }}
    />
  );
}

// ─── Stat Card Skeleton ────────────────────────────────────────────────────────
export function SkeletonStat() {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-8 w-14" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-10 w-10 rounded-xl" />
      </div>
    </div>
  );
}

// ─── Card Skeleton ─────────────────────────────────────────────────────────────
export function SkeletonCard() {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div className="space-y-2 flex-1">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="h-6 w-16 rounded-full ml-3 flex-shrink-0" />
      </div>
      <Skeleton className="h-3 w-40" />
      <div className="space-y-2">
        <Skeleton className="h-2 w-full rounded-full" />
        <div className="flex justify-between">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-10" />
        </div>
      </div>
      <div className="pt-3 border-t border-slate-800/60 flex justify-between items-center">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-4 w-4 rounded" />
      </div>
    </div>
  );
}

// ─── Table Row Skeleton ────────────────────────────────────────────────────────
export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-2.5 rounded-xl bg-slate-800/40">
        {[30, 40, 25, 20, 30].map((w, i) => (
          <Skeleton key={i} className={`h-3 w-${w < 25 ? '16' : w < 35 ? '20' : '28'} flex-shrink-0`} />
        ))}
      </div>
      {/* Rows */}
      {[...Array(rows)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5 bg-slate-900 border border-slate-800 rounded-2xl">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
          <div className="ml-auto">
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Page Header Skeleton ──────────────────────────────────────────────────────
export function SkeletonHeader() {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-2">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="h-9 w-24 rounded-xl" />
    </div>
  );
}

// ─── Visit Detail Skeleton ─────────────────────────────────────────────────────
export function SkeletonVisitDetail() {
  return (
    <div className="space-y-4 max-w-4xl">
      <Skeleton className="h-4 w-28 rounded-lg" />
      {/* Header card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex justify-between">
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="h-10 w-28 rounded-xl" />
        </div>
        <div className="flex gap-4 pt-3 border-t border-slate-800">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-4 w-32" />)}
        </div>
      </div>
      {/* Progress card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
        <div className="flex justify-between">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-7 w-14" />
        </div>
        <Skeleton className="h-3 w-full rounded-full" />
      </div>
      {/* Task cards */}
      {[...Array(3)].map((_, i) => (
        <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center gap-4">
          <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-2 w-24 rounded-full" />
          </div>
          <Skeleton className="h-4 w-4 rounded" />
        </div>
      ))}
    </div>
  );
}
