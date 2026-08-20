"use client";

/**
 * Keeps browser-side `fetch("/api/...")` inside the app's mount point.
 *
 * Next.js applies `basePath` to <Link>, router navigation, /_next/* assets and
 * next/image, but NOT to `fetch`. The ~60 call sites across this app all use
 * root-absolute paths ("/api/admin/visits", "/api/auth/login", ...), which the
 * browser resolves against the ORIGIN. Served from the domain root that is
 * exactly right; served from a sub-path behind a reverse proxy it sends every
 * request to https://host/api/... instead of https://host/<basePath>/api/...,
 * which is outside the proxied location — login and every screen would fail.
 *
 * Rather than rewriting every call site (and risking a regression in working
 * business logic), the base path is applied once, here, to same-origin
 * requests that start with "/api/". Everything else — absolute URLs, Request
 * objects, already-prefixed paths, Next's own internal fetches — is passed
 * through untouched.
 *
 * When NEXT_PUBLIC_BASE_PATH is unset (localhost, Vercel) this does nothing at
 * all: no patch is installed and fetch behaves exactly as before.
 */

const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");

declare global {
  interface Window {
    __smcFetchBasePathApplied?: boolean;
  }
}

if (typeof window !== "undefined" && basePath && !window.__smcFetchBasePathApplied) {
  window.__smcFetchBasePathApplied = true;

  const originalFetch = window.fetch.bind(window);

  const withBasePath = (path: string): string =>
    path.startsWith("/api/") || path === "/api" ? `${basePath}${path}` : path;

  window.fetch = function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    if (typeof input === "string") {
      return originalFetch(withBasePath(input), init);
    }
    if (input instanceof URL && input.origin === window.location.origin) {
      const next = new URL(input.href);
      next.pathname = withBasePath(next.pathname);
      return originalFetch(next, init);
    }
    // Request objects and cross-origin URLs are left alone.
    return originalFetch(input as RequestInfo, init);
  };
}

export default function BasePathFetch() {
  return null;
}
