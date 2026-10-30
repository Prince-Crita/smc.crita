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
 */
export const BASE_PATH = resolveBasePath({
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_BASE_PATH: process.env.NEXT_PUBLIC_BASE_PATH,
  BUILD_STANDALONE: process.env.BUILD_STANDALONE,
});

/**
 * Resolve a path in /public for the mount point the app is served from.
 *
 * Next.js prefixes <Link>, router navigation and /_next/* automatically when
 * `basePath` is configured, but two things are passed through verbatim and so
 * have to be resolved here:
 *
 *   1. URLs written by hand in a `metadata` export (the favicon tags).
 *   2. The `src` of a next/image, which Next copies straight into the
 *      `?url=` parameter of /_next/image. The optimizer resolves that
 *      parameter through the router, where an un-prefixed "/logo.png" no
 *      longer exists — everything is served under the base path — and answers
 *      400 "The requested resource isn't a valid image".
 */
export function assetPath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${BASE_PATH}${normalized}`;
}
