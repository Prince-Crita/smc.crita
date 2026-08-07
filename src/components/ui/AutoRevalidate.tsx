"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * AutoRevalidate
 * -----------------------------------------------------------------------
 * For pages that are React Server Components (data fetched directly via
 * Prisma at request time, no client-side fetch/useState), this tiny client
 * component calls `router.refresh()` - which re-runs the server component on
 * the current route and patches the result in, WITHOUT a page reload, without
 * losing client state or scroll position, and without a UI flicker.
 *
 * It is the RSC equivalent of useLiveQuery's revalidation, and deliberately
 * mirrors its rules so both halves of the app behave identically:
 *
 *   - revalidate when the window regains focus            (default ON)
 *   - revalidate when the tab becomes visible again       (default ON)
 *   - interval polling                                    (default OFF)
 *
 * Focus/visibility are OS/user events, not polling: the page stays completely
 * idle while nobody is looking at it and re-syncs the moment the user comes
 * back. That is what stops an admin sitting on a visit-detail page from seeing
 * a stale status after the executive has closed the visit - the one page in
 * the app that is a server component and therefore cannot use useLiveQuery.
 *
 * Bursts of focus/visibility events (alt-tabbing, devtools, notifications)
 * are collapsed by MIN_REFRESH_GAP_MS so they can never become a request
 * storm. If an interval IS explicitly requested it is clamped to a minimum of
 * 60 seconds; polling every few seconds is forbidden here.
 */

const MIN_POLL_MS = 60000;
/** Matches useLiveQuery's MIN_REFETCH_GAP_MS so both behave the same. */
const MIN_REFRESH_GAP_MS = 3000;

export function AutoRevalidate({
  intervalMs = 0,
  revalidateOnFocus = true,
  revalidateOnVisible = true,
}: {
  intervalMs?: number;
  revalidateOnFocus?: boolean;
  revalidateOnVisible?: boolean;
}) {
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => { routerRef.current = router; });

  const lastRefreshAtRef = useRef(0);

  const refresh = useCallback(() => {
    const now = Date.now();
    if (now - lastRefreshAtRef.current < MIN_REFRESH_GAP_MS) return;
    lastRefreshAtRef.current = now;
    routerRef.current.refresh();
  }, []);

  // Focus / visibility revalidation - event-driven, never polling.
  useEffect(() => {
    const onFocus = () => { if (revalidateOnFocus) refresh(); };
    const onVisibility = () => {
      if (revalidateOnVisible && document.visibilityState === "visible") refresh();
    };
    if (revalidateOnFocus) window.addEventListener("focus", onFocus);
    if (revalidateOnVisible) document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (revalidateOnFocus) window.removeEventListener("focus", onFocus);
      if (revalidateOnVisible) document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [revalidateOnFocus, revalidateOnVisible, refresh]);

  // Optional interval - OFF by default.
  const effectiveMs = intervalMs > 0 ? Math.max(intervalMs, MIN_POLL_MS) : 0;
  useEffect(() => {
    if (!effectiveMs) return;
    const id = setInterval(() => routerRef.current.refresh(), effectiveMs);
    return () => clearInterval(id);
  }, [effectiveMs]);

  return null;
}
