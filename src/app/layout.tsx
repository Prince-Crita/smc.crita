import type { Metadata } from "next";
import { SpeedInsights } from '@vercel/speed-insights/next';
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "SMC Task Management Module",
  description: "Production audit task management system for SMC Audit Services — manage visits, tasks, carry-forwards, and executive field operations.",
  icons: {
    // Standard browser favicon (Next.js also auto-serves src/app/icon.png)
    icon: [
      { url: "/favicon-16.png",  sizes: "16x16",   type: "image/png" },
      { url: "/favicon-32.png",  sizes: "32x32",   type: "image/png" },
      { url: "/favicon-48.png",  sizes: "48x48",   type: "image/png" },
      { url: "/favicon-64.png",  sizes: "64x64",   type: "image/png" },
      { url: "/favicon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/favicon-512.png", sizes: "512x512", type: "image/png" },
    ],
    // Apple home screen icon
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    // PWA shortcut icon
    shortcut: "/favicon-32.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body className="font-sans antialiased bg-[#f8f9fc] text-[#0f1829]">
        {children}
        <SpeedInsights />

      </body>
    </html>
  );
}
