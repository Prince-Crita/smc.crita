import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyJwt, COOKIE_NAME } from "@/lib/auth/jwt";
import Sidebar from "@/components/layout/Sidebar";
import BottomNav from "@/components/layout/BottomNav";
import { Toaster } from "react-hot-toast";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (!token) redirect("/login");

  const user = await verifyJwt(token);
  if (!user) redirect("/login");

  const isExecutive = user.role === "EXECUTIVE";

  return (
    <div className="min-h-screen bg-slate-950 flex">
      <Sidebar userRole={user.role} userName={user.name} userEmail={user.email} />

      <div className="flex-1 flex flex-col min-w-0">
        {/* ── Top header bar ────────────────────────────────────────── */}
        <header className="sticky top-0 z-20 h-14 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80 flex items-center px-4 lg:px-6 gap-4">
          {/* Left spacer for admin hamburger on mobile */}
          <div className={`flex-1 min-w-0 ${isExecutive ? "" : "ml-10 lg:ml-0"}`}>
            <div className="flex items-center gap-2">
              <p className="text-xs text-slate-600 truncate hidden sm:block">
                SMC Audit Services
                <span className="mx-1.5 text-slate-700">›</span>
                <span className="text-slate-500">
                  {user.role === "ADMIN" ? "Administration" : "Field Executive"}
                </span>
              </p>
              {/* Mobile: show app name for executives */}
              {isExecutive && (
                <p className="text-sm font-semibold text-white sm:hidden">SMC Audit</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Role badge */}
            <div className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${
              user.role === "ADMIN"
                ? "bg-purple-500/10 border-purple-500/20 text-purple-400"
                : "bg-blue-500/10 border-blue-500/20 text-blue-400"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                user.role === "ADMIN" ? "bg-purple-400" : "bg-blue-400"
              } animate-pulse`} />
              {user.role === "ADMIN" ? "Admin" : "Executive"}
            </div>

            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-xs font-bold shadow-sm ring-2 ring-slate-800">
              {user.name.charAt(0).toUpperCase()}
            </div>
          </div>
        </header>

        {/* ── Main content ──────────────────────────────────────────── */}
        {/* pb-20 lg:pb-6 gives room for bottom nav on mobile */}
        <main className={`flex-1 p-4 lg:p-6 overflow-auto animate-in ${isExecutive ? "pb-20 lg:pb-6" : ""}`}>
          {children}
        </main>
      </div>

      {/* ── Mobile bottom nav (Executive only) ────────────────────── */}
      {isExecutive && <BottomNav />}

      {/* ── Toast notifications ───────────────────────────────────── */}
      <Toaster
        position="top-right"
        gutter={8}
        containerStyle={{ top: 64 }}
        toastOptions={{
          duration: 3500,
          style: {
            background: "#1e293b",
            color: "#f1f5f9",
            border: "1px solid #334155",
            borderRadius: "14px",
            fontSize: "13px",
            fontWeight: "500",
            padding: "12px 16px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            maxWidth: "360px",
          },
          success: {
            iconTheme: { primary: "#10b981", secondary: "#1e293b" },
            style: {
              borderColor: "#10b981/30",
            },
          },
          error: {
            iconTheme: { primary: "#f87171", secondary: "#1e293b" },
            style: {
              borderColor: "#f87171/30",
            },
          },
        }}
      />
    </div>
  );
}
