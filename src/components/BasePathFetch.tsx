"use client";

/**
 * Keeps browser-side `fetch("/api/...")` inside the app's mount point.
 *
 * Next.js applies `basePath` to <Link>, router navigation, /_next/* assets and
 * next/image, but NOT to `fetch`. This patch prefixes same-origin /api/* calls.
 */

import { getActiveBasePath } from "@/lib/utils/asset-path";

declare global {
  interface Window {
    __smcFetchBasePathApplied?: boolean;
  }
}

if (typeof window !== "undefined" && !window.__smcFetchBasePathApplied) {
  window.__smcFetchBasePathApplied = true;

  const originalFetch = window.fetch.bind(window);

  const withBasePath = (path: string): string => {
    const basePath = getActiveBasePath();
    if (!basePath) return path;
    return path.startsWith("/api/") || path === "/api" ? `${basePath}${path}` : path;
  };

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
    return originalFetch(input as RequestInfo, init);
  };
}

export default function BasePathFetch() {
  return null;
}
