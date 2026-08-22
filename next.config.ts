import type { NextConfig } from "next";
import { APP_BASE_PATH, resolveBasePath } from "./config/base-path.mjs";

/**
 * Mount point of the application.
 *
 * EMPTY BY DEFAULT — locally and on Vercel the app keeps serving from the
 * domain root exactly as before (http://localhost:3000/, /api/...).
 *
 * Company-server standalone builds default to APP_BASE_PATH in config/base-path.mjs.
 * Override with NEXT_PUBLIC_BASE_PATH at build time if needed.
 *
 * The proxy must forward the request URI UNCHANGED (do not strip the prefix).
 */
const basePath = resolveBasePath();

/**
 * Self-contained server output for the company server.
 *
 * OFF BY DEFAULT so the existing Vercel deployment keeps using Vercel's own
 * build pipeline unchanged. Set BUILD_STANDALONE=1 at BUILD TIME to make
 * `next build` additionally emit `.next/standalone/` — a minimal Node server
 * plus only the traced runtime dependencies, which is what gets copied to a
 * self-managed server.
 *
 *   BUILD_STANDALONE=1 NEXT_PUBLIC_BASE_PATH=/client-trial/smc-task-management npm run build
 */
const standalone = process.env.BUILD_STANDALONE === "1";

const nextConfig: NextConfig = {
  experimental: {},

  // Serve from a sub-path only when explicitly configured; "" = domain root.
  ...(basePath ? { basePath } : {}),

  // Emit .next/standalone for self-managed deployment; off on Vercel.
  ...(standalone ? { output: "standalone" as const } : {}),

  // Ignore TypeScript errors during production build
  typescript: {
    ignoreBuildErrors: true,
  },

  serverExternalPackages: ["bcryptjs", "@prisma/client", "pg"],

  compress: true,

  productionBrowserSourceMaps: false,

  // ─── API responses must never be re-used from a cache ──────────────────────
  //
  // These endpoints previously carried
  //   Cache-Control: private, s-maxage=<n>, stale-while-revalidate=<2n>
  // as a performance measure. It also made the app show stale data, and this
  // was reproduced in a browser: an admin deletes an executive's visit, and
  // the executive's very next load of /api/visits is answered from the local
  // HTTP cache (transferSize 0) and still lists the deleted visit.
  //
  // The reason is that the directive set no `max-age`, so a browser gets a
  // freshness lifetime of zero — but `stale-while-revalidate` then permits it
  // to serve the stale copy anyway while it refreshes in the background. The
  // first read after ANY change could therefore be wrong: a reassignment, a
  // closed visit, a completed subtask, a carry-forward decision, a punch-out.
  //
  // Admin ↔ Executive synchronisation is the whole point of these screens, so
  // correctness wins: every API read goes to the server. The cost this used to
  // save has been recovered many times over on the server side instead (the
  // per-visit COUNT aggregates in lib/utils/visit-aggregates.ts), and the app
  // already collapses duplicate in-flight GETs in fetchJSON.
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
