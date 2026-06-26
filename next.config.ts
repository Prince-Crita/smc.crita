import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {},

  // Keep server-only heavy deps out of client bundles (Next.js 16 top-level key)
  serverExternalPackages: ["bcryptjs", "@prisma/client", "pg"],

  // Gzip compress responses — reduces payload size by ~70% for JSON API responses
  compress: true,

  // No source maps in production — reduces bundle size & prevents code exposure
  productionBrowserSourceMaps: false,

  // HTTP cache-control headers for read-only API routes.
  // s-maxage allows CDN/proxy caching; stale-while-revalidate serves stale
  // content while background refresh happens — makes repeat navigation instant.
  async headers() {
    return [
      {
        // Dashboard stats: cache for 30s at CDN, serve stale for up to 60s
        source: "/api/admin/stats",
        headers: [
          {
            key: "Cache-Control",
            value: "private, s-maxage=30, stale-while-revalidate=60",
          },
        ],
      },
      {
        // Executives list: changes infrequently — cache for 60s
        source: "/api/admin/executives",
        headers: [
          {
            key: "Cache-Control",
            value: "private, s-maxage=60, stale-while-revalidate=120",
          },
        ],
      },
      {
        // Clients list: cache for 60s
        source: "/api/admin/clients",
        headers: [
          {
            key: "Cache-Control",
            value: "private, s-maxage=60, stale-while-revalidate=120",
          },
        ],
      },
      {
        // Executive visits: cache for 15s — changes more frequently
        source: "/api/visits",
        headers: [
          {
            key: "Cache-Control",
            value: "private, s-maxage=15, stale-while-revalidate=30",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
