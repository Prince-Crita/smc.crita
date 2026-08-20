import type { Metadata } from "next";
import { SpeedInsights } from '@vercel/speed-insights/next';
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./globals.css";
import { assetPath, BASE_PATH } from "@/lib/utils/asset-path";
import BasePathFetch from "@/components/BasePathFetch";


export const metadata: Metadata = {
  title: "SMC Task Management Module",
  description: "Production audit task management system for SMC Audit Services — manage visits, tasks, carry-forwards, and executive field operations.",
  icons: {
    // Standard browser favicon (Next.js also auto-serves src/app/icon.png)
    icon: [
      { url: assetPath("/favicon-16.png"),  sizes: "16x16",   type: "image/png" },
      { url: assetPath("/favicon-32.png"),  sizes: "32x32",   type: "image/png" },
      { url: assetPath("/favicon-48.png"),  sizes: "48x48",   type: "image/png" },
      { url: assetPath("/favicon-64.png"),  sizes: "64x64",   type: "image/png" },
      { url: assetPath("/favicon-192.png"), sizes: "192x192", type: "image/png" },
      { url: assetPath("/favicon-512.png"), sizes: "512x512", type: "image/png" },
    ],
    // Apple home screen icon
    apple: [
      { url: assetPath("/apple-touch-icon.png"), sizes: "180x180", type: "image/png" },
    ],
    // PWA shortcut icon
    shortcut: assetPath("/favicon-32.png"),
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body className="font-sans antialiased bg-[#f8f9fc] text-[#0f1829]">
        <BasePathFetch />
        {children}
        {/* Vercel-only telemetry. It requests /_vercel/speed-insights/script.js from
            the DOMAIN ROOT, which escapes the prefix and 404s on a self-hosted
            sub-path deployment. Rendered only when the app is root-mounted, so
            the Vercel deployment is completely unaffected. */}
        {/* Also gated on production: in local development this script 404s
            (it is served by Vercel's edge, which is not present here) and the
            package still beacons out to va.vercel-scripts.com. Local
            development should make no outbound requests at all. */}
        {!BASE_PATH && process.env.NODE_ENV === "production" && <SpeedInsights />}

      </body>
    </html>
  );
}
