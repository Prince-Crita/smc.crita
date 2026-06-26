import type { Metadata } from "next";
// @fontsource/inter bundles the font files locally — no network requests at
// build time. Replaces the next/font/google Inter import that fails in
// sandboxed / offline build environments.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "SMC Task Management Module",
  description: "Production audit task management system for SMC Audit Services — manage visits, tasks, carry-forwards, and executive field operations.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased bg-slate-950 text-white">
        {children}
      </body>
    </html>
  );
}
