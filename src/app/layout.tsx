import type { Metadata } from "next";
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
    <html lang="en" data-scroll-behavior="smooth">
      <body className="font-sans antialiased bg-[#f8f9fc] text-[#0f1829]">
        {children}
      </body>
    </html>
  );
}
