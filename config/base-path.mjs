/**
 * Single source of truth for the company-server mount point.
 *
 * Production URL: https://server.crita.in/client-trial/smc-task-management/
 *
 * Local dev and Vercel stay at the domain root unless NEXT_PUBLIC_BASE_PATH is
 * set explicitly. Standalone builds (BUILD_STANDALONE=1) default to APP_BASE_PATH.
 */

export const APP_BASE_PATH = "/client-trial/smc-task-management";

export const PUBLIC_APP_ORIGIN = "https://server.crita.in";

/** Full public URL of the deployed app (no trailing slash). */
export const PUBLIC_APP_URL = `${PUBLIC_APP_ORIGIN}${APP_BASE_PATH}`;

/**
 * Resolve the active base path for Next.js and runtime helpers.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} Mount point without trailing slash ("" = domain root).
 */
export function resolveBasePath(env = process.env) {
  const explicit = env.NEXT_PUBLIC_BASE_PATH;

  if (explicit === "") {
    return "";
  }

  if (explicit !== undefined) {
    return explicit.replace(/\/$/, "");
  }

  if (env.BUILD_STANDALONE === "1") {
    return APP_BASE_PATH;
  }

  return "";
}
