import { APP_BASE_PATH } from "../../../config/base-path.mjs";

/**
 * Must reference `process.env.NEXT_PUBLIC_BASE_PATH` directly — Next.js only
 * inlines literal `process.env.NEXT_PUBLIC_*` reads into the client bundle.
 * Dynamic lookups (e.g. env.NEXT_PUBLIC_BASE_PATH in resolveBasePath) are NOT
 * inlined, which left BASE_PATH empty in the browser and sent fetch("/api/...")
 * to the domain root instead of /client-trial/smc-task-management/api/...
 */
const publicBasePath = process.env.NEXT_PUBLIC_BASE_PATH;

/** The configured mount point ("" when the app is served from the domain root). */
export const BASE_PATH = (
  publicBasePath !== undefined ? publicBasePath : ""
).replace(/\/$/, "");

export { APP_BASE_PATH, PUBLIC_APP_ORIGIN, PUBLIC_APP_URL } from "../../../config/base-path.mjs";

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
