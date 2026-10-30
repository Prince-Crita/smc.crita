import {
  APP_BASE_PATH,
  PUBLIC_APP_ORIGIN,
  PUBLIC_APP_URL,
  resolveBasePath,
} from "../../../config/base-path.mjs";

export { APP_BASE_PATH, PUBLIC_APP_ORIGIN, PUBLIC_APP_URL };

/**
 * The configured mount point ("" when the app is served from the domain root).
 *
 * Read through LITERAL `process.env.X` expressions: Next.js inlines those at
 * build time into the browser and server bundles. Passing the process.env
 * object itself (resolveBasePath()'s default) is not inlined — the browser
 * then saw an empty env, BASE_PATH was "", and on the company server every
 * browser-side fetch("/api/...") and favicon link missed the mount point.
 * next.config.ts also passes NEXT_PUBLIC_BASE_PATH through `env` for the same reason.
 */
export const BASE_PATH = resolveBasePath({
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_BASE_PATH: process.env.NEXT_PUBLIC_BASE_PATH,
  BUILD_STANDALONE: process.env.BUILD_STANDALONE,
});

/**
 * Base path active in this context. Uses the build-time value when present,
 * otherwise detects the company-server mount from the current URL (helps when
 * an older build missed the env inlining).
 */
export function getActiveBasePath(): string {
  if (BASE_PATH) return BASE_PATH;

  if (typeof window !== "undefined") {
    const path = window.location.pathname;
    if (path === APP_BASE_PATH || path.startsWith(`${APP_BASE_PATH}/`)) {
      return APP_BASE_PATH;
    }
  }

  return "";
}

/** Prefix an API or app path with the active mount point. */
export function apiPath(path: string): string {
  const base = getActiveBasePath();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${normalized}` : normalized;
}

/**
 * Resolve a path in /public for the mount point the app is served from.
 *
 * Next.js prefixes <Link>, router navigation and /_next/* automatically when
 * `basePath` is configured, but metadata favicons and next/image `src` values
 * must be prefixed manually.
 */
export function assetPath(path: string): string {
  return apiPath(path);
}
