"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * AutoRevalidate
 * -----------------------------------------------------------------------
 * For pages that are React Server Components (data fetched directly via
 * Prisma at request time, no client-side fetch/useState), this tiny client
 * component can call `router.refresh()` - which re-runs the server
 * component on the current route - on a fixed interval.
 *
 * IMPORTANT: it does NOTHING by default. All automatic refresh triggers
 * (focus, visibility, short intervals) were removed - the app must stay
 * completely idle after load and refresh only after real data mutations.
 * If an interval is explicitly requested, it is clamped to a minimum of
 * 60 seconds; polling every few seconds is forbidden.
 */

const MIN_POLL_MS = 60000;

export function AutoRevalidate({ intervalMs = 0 }: { intervalMs?: number }) {
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => { routerRef.current = router; });

  const effectiveMs = intervalMs > 0 ? Math.max(intervalMs, MIN_POLL_MS) : 0;

  useEffect(() => {
    if (!effectiveMs) return; // default: completely inert
    const id = setInterval(() => routerRef.current.refresh(), effectiveMs);
    return () => clearInterval(id);
  }, [effectiveMs]);

  return null;
}
