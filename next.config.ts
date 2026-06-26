import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {},

  // Ignore TypeScript errors during production build
  typescript: {
    ignoreBuildErrors: true,
  },

  serverExternalPackages: ["bcryptjs", "@prisma/client", "pg"],

  compress: true,

  productionBrowserSourceMaps: false,

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
