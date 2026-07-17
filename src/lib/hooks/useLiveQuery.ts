"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

/**
 * fetchJSON
 * -----------------------------------------------------------------------
 * Safe wrapper around `fetch` for GET endpoints consumed by useLiveQuery.
 *
 * Guards against the "Unexpected token '<' ... <!DOCTYPE" crash that
 * happens when `response.json()` is called on a non-JSON response (e.g. an
 * HTML error page returned by a redirect, a proxy, or an unhandled 500
 * without a JSON body). It:
 *   1. Checks `response.ok` before attempting to parse anything.
 *   2. Checks the `Content-Type` header contains `application/json` before
 *      calling `response.json()`.
 *   3. Throws a normal Error (never lets a JSON.parse SyntaxError escape)
 *      so callers/useLiveQuery's existing try/catch can handle it - no
 *      retry loop is triggered by this helper itself.
 */
// ── GET request deduplication ────────────────────────────────────────────
// Multiple components frequently need the same endpoint at the same moment
// (e.g. a page + a modal both loading /api/admin/executives, or React
// StrictMode double-invoking effects in dev). Instead of firing duplicate
// network requests, identical in-flight GETs share ONE promise. The entry is
// removed as soon as the request settles - this is purely concurrent
// deduplication, NOT a stale cache, so mutation-driven refresh() calls
// always hit the network for fresh data.
const inFlightGets = new Map<string, Promise<unknown>>();

async function doFetchJSON<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  // Read as TEXT first and JSON.parse manually inside try/catch. This makes
  // it structurally impossible for a "SyntaxError: Unexpected token '<',
  // <!DOCTYPE..." to escape this helper, no matter what the server returned
  // (HTML error page, redirect target, proxy page, empty body, ...).
  let bodyText = "";
  try {
    bodyText = await response.text();
  } catch {
    bodyText = "";
  }

  let parsed: unknown = null;
  if (isJson && bodyText) {
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      parsed = null; // malformed JSON - treated as no body below
    }
  }

  if (!response.ok) {
    const serverError = (parsed as { error?: string } | null)?.error;
    throw new Error(serverError || `Request failed (${response.status})`);
  }

  if (!isJson || parsed === null) {
    // 2xx but not parseable JSON (e.g. an HTML page from an auth redirect).
    // Throw a plain, descriptive Error - callers handle it gracefully and
    // nothing retries automatically, so no refresh loop can start here.
    throw new Error("Unexpected response format (expected JSON)");
  }

  return parsed as T;
}

export async function fetchJSON<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();

  // Only plain GETs are deduplicated; mutations always go through.
  if (method !== "GET") return doFetchJSON<T>(input, init);

  const key = typeof input === "string" ? input : input instanceof URL ? input.toString() : JSON.stringify(input);
  const existing = inFlightGets.get(key);
  if (existing) return existing as Promise<T>;

  const promise = doFetchJSON<T>(input, init).finally(() => {
    inFlightGets.delete(key);
  });
  inFlightGets.set(key, promise);
  return promise;
}

/**
 * useLiveQuery
 * -----------------------------------------------------------------------
 * Lightweight, dependency-free data-revalidation hook. Wraps a fetcher
 * function and refetches ONLY:
 *   1. on mount (and when the fetcher's params change),
 *   2. on an explicit refresh()/mutate() call after a data mutation
 *      (visit changed, task updated, leave approved, ...).
 *
 * NOTHING else triggers a fetch. Focus/visibility revalidation is DISABLED
 * by default and interval polling is DISABLED by default (intervalMs = 0).
 * The app is completely idle after load - no background network traffic, no
 * re-renders - until the user performs an action. Pages with a genuine
 * cross-user live-sync requirement (e.g. Admin Attendance watching executive
 * punch-ins) may opt in with an explicit intervalMs; any non-zero value is
 * clamped to a MINIMUM of 60 seconds - short polling is forbidden.
 *
 * IMPORTANT: `loading` is only true while there is NO data yet (initial
 * load). Background revalidations update data silently - they must never
 * flip the page back to its skeleton state, which reads as a full page
 * "auto refresh" to the user.
 *
 * It also exposes a manual `refresh()` (aliased as `mutate()`) so existing
 * local-mutation flows (create/update/delete handlers that already call a
 * `refresh()` after a successful POST) keep working unchanged.
 *
 * This does not introduce any new npm dependency - it is a thin wrapper
 * around useState/useEffect mirroring the fetch pattern already used
 * throughout the app.
 */

export interface UseLiveQueryOptions {
  /**
   * Poll interval in ms. Defaults to 0 (polling DISABLED - the app must be
   * idle after load). Only opt in on pages with a real cross-user live-sync
   * requirement. Any non-zero value below 60000 is clamped UP to 60000 -
   * polling every few seconds is forbidden.
   */
  intervalMs?: number;
  /** Refetch when the window regains focus. Defaults to FALSE - refreshes are mutation-driven. */
  revalidateOnFocus?: boolean;
  /** Refetch when the tab becomes visible again. Defaults to FALSE - refreshes are mutation-driven. */
  revalidateOnVisible?: boolean;
  /** Set to false to skip fetching entirely (e.g. while a required param is missing). */
  enabled?: boolean;
}

export interface UseLiveQueryResult<T> {
  data: T | null;
  loading: boolean;
  error: unknown;
  /** Manually re-run the fetcher. */
  refresh: () => Promise<void>;
  /** Alias for refresh() - familiar SWR/react-query-style name. */
  mutate: () => Promise<void>;
  /**
   * Escape hatch for optimistic local patches (e.g. patch one task in a
   * visit after a save, without a full refetch). Mirrors React's setState.
   */
  setData: Dispatch<SetStateAction<T | null>>;
}

export function useLiveQuery<T>(
  fetcher: () => Promise<T>,
  options: UseLiveQueryOptions = {}
): UseLiveQueryResult<T> {
  const {
    intervalMs: rawIntervalMs = 0,
    revalidateOnFocus = false,
    revalidateOnVisible = false,
    enabled = true,
  } = options;

  // Hard floor: polling faster than 60s is never allowed, no matter what a
  // caller passes. 0 stays 0 (no polling at all).
  const MIN_POLL_MS = 60000;
  const intervalMs = rawIntervalMs > 0 ? Math.max(rawIntervalMs, MIN_POLL_MS) : 0;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  // Keep the latest fetcher in a ref so effects don't need it in their dep
  // array (callers typically pass an inline function / useCallback that may
  // change identity on every render based on filters/params).
  const fetcherRef = useRef(fetcher);
  useEffect(() => { fetcherRef.current = fetcher; });

  // Guards against request storms:
  //  - inFlightRef: never start a second fetch while one is still pending
  //    (e.g. a focus event firing milliseconds after mount, or after the
  //    poll interval, while the previous request hasn't resolved yet).
  //  - lastRunAtRef + MIN_REFETCH_GAP_MS: focus/visibility listeners can
  //    fire in rapid bursts in real browsers (alt-tabbing, devtools panel
  //    switches, notification popups stealing/returning focus). Without a
  //    floor, each of those bursts is a separate network request. Explicit
  //    triggers (initial mount, dependency/filter changes, and manual
  //    refresh()/mutate() after a mutation) always bypass this floor so
  //    real-time sync after user actions is never delayed.
  const inFlightRef = useRef(false);
  const lastRunAtRef = useRef(0);
  const MIN_REFETCH_GAP_MS = 3000;

  // Tracks whether we already have data. Background revalidations must NOT
  // set loading=true when data exists - most pages render a full skeleton on
  // `loading`, so flipping it during a background refetch makes the whole
  // page visually "reload" (the auto-refresh bug). Only the very first fetch
  // (no data yet) shows the loading state.
  const hasDataRef = useRef(false);

  const run = useCallback(async (opts?: { force?: boolean }) => {
    if (!enabled) return;
    if (inFlightRef.current) return;
    const now = Date.now();
    if (!opts?.force && now - lastRunAtRef.current < MIN_REFETCH_GAP_MS) return;

    inFlightRef.current = true;
    lastRunAtRef.current = now;
    if (!hasDataRef.current) setLoading(true);
    try {
      const result = await fetcherRef.current();
      hasDataRef.current = true;
      setData(result);
      setError(null);
    } catch (err) {
      setError(err);
      console.error(err);
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }, [enabled]);

  const forcedRun = useCallback(() => run({ force: true }), [run]);

  // Fetch on mount / whenever `enabled` or the fetcher identity changes
  // (identity changes happen when the caller's query params change, since
  // fetcher is usually a useCallback keyed on those params). Always forced -
  // these are explicit, user/param-driven triggers, never a rapid-fire storm.
  useEffect(() => {
    forcedRun();
  }, [forcedRun, fetcher]);

  // Revalidate on window focus / tab visibility - subject to the throttle
  // above so bursts of focus/visibility events collapse into one request.
  useEffect(() => {
    if (!enabled) return;
    const onFocus = () => { if (revalidateOnFocus) run(); };
    const onVisibility = () => {
      if (revalidateOnVisible && document.visibilityState === "visible") run();
    };
    if (revalidateOnFocus) window.addEventListener("focus", onFocus);
    if (revalidateOnVisible) document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (revalidateOnFocus) window.removeEventListener("focus", onFocus);
      if (revalidateOnVisible) document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, revalidateOnFocus, revalidateOnVisible, run]);

  // Poll on an interval as a fallback for open background tabs
  useEffect(() => {
    if (!enabled || !intervalMs) return;
    const id = setInterval(run, intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs, run]);

  // refresh()/mutate() are the explicit "I just performed a mutation, get me
  // fresh data now" API used throughout the app's create/update/delete
  // handlers - always forced so a user action is never delayed by the
  // focus/visibility throttle.
  return { data, loading, error, refresh: forcedRun, mutate: forcedRun, setData };
}
