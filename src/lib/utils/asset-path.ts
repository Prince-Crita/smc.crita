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
 *
 * With no base path configured (localhost, Vercel) this returns its argument
 * unchanged, so nothing about the current deployment changes.
 */
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");

/** The configured mount point ("" when the app is served from the domain root). */
export const BASE_PATH = basePath;

export function assetPath(path: string): string {
  return `${basePath}${path}`;
}
