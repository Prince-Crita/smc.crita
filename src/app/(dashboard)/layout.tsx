import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyJwt, COOKIE_NAME } from "@/lib/auth/jwt";
import { isAdminRole } from "@/lib/auth/roles";
import Sidebar from "@/components/layout/Sidebar";
import BottomNav from "@/components/layout/BottomNav";
import AdminBottomNav from "@/components/layout/AdminBottomNav";
import { Toaster } from "react-hot-toast";
import Image from "next/image";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (!token) redirect("/login");

  const user = await verifyJwt(token);
  if (!user) redirect("/login");

  const isExecutive = user.role === "EXECUTIVE";
  const isAdmin = isAdminRole(user.role);
  const roleLabel = user.role === "SUPER_ADMIN" ? "Super Admin" : user.role === "ADMIN" ? "Admin" : "Executive";

  return (
    <div className="min-h-screen bg-[#f8f9fc] flex">
      <Sidebar userRole={user.role} userName={user.name} userEmail={user.email} />

      <div className="flex-1 flex flex-col min-w-0">
        {/* ── Top header bar ────────────────────────────────────────── */}
        <header className="sticky top-0 z-20 h-14 bg-white border-b border-[#e2e7f0] flex items-center px-4 lg:px-6 gap-4 shadow-sm">
          {/* Left — breadcrumb / page context */}
          <div className={`flex-1 min-w-0 ${isExecutive ? "" : "ml-10 lg:ml-0"}`}>
            <div className="flex items-center gap-2">
              <p className="text-xs text-[#8896a9] truncate hidden sm:block">
                SMC Audit Services
                <span className="mx-1.5 text-[#c8d2e0]">›</span>
                <span className="text-[#4a5568]">
                  {isAdmin ? "Administration" : "Field Executive"}
                </span>
              </p>
              {/* Mobile: show company logo instead of plain text — same for Admin & Executive */}
              <div className="sm:hidden">
                <Image
                  src="/logo.png"
                  alt="Shaabi Management Consultancy"
                  width={600}
                  height={200}
                  className="object-contain h-9 w-auto"
                  priority
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Role badge */}
            <div className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${
              isAdmin
                ? "bg-[#eef2f9] border-[#adc2e2] text-[#25488e]"
                : "bg-[#fff0f6] border-[#ffadd1] text-[#800040]"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                isAdmin ? "bg-[#25488e]" : "bg-[#800040]"
              }`} />
              {roleLabel}
            </div>

            {/* Avatar */}
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm ring-2 ring-[#e2e7f0] ${
              isAdmin ? "bg-[#25488e]" : "bg-[#800040]"
            }`}>
              {user.name.charAt(0).toUpperCase()}
            </div>
          </div>
        </header>

        {/* ── Main content ── */}
        <main className="flex-1 p-4 lg:p-6 pb-20 lg:pb-6 overflow-auto animate-in">
          {children}
        </main>
      </div>

      {/* ── Mobile bottom nav ── */}
      {isExecutive ? <BottomNav /> : <AdminBottomNav userRole={user.role} />}

      {/* ── Toast notifications ──────────────────────────────────────────
          zIndex must beat every overlay in the app. Modal/ConfirmDialog
          portal into document.body with z-[9999]; react-hot-toast's own
          container also defaults to 9999 but is rendered here, EARLIER in
          the DOM, so on an equal z-index the modal painted over it and an
          error raised from inside a modal (e.g. Duplicate Client) was
          invisible until the modal was closed. One value above every
          overlay — modal, dialog, sheet, dropdown (z-[80]), popover,
          drawer — fixes the stacking for the whole application without
          touching the alert system itself. */}
      <Toaster
        position="top-right"
        gutter={8}
        containerStyle={{ top: 64, zIndex: 2147483000 }}
        toastOptions={{
          duration: 3500,
          style: {
            background: "#ffffff",
            color: "#0f1829",
            border: "1px solid #e2e7f0",
            borderRadius: "12px",
            fontSize: "13px",
            fontWeight: "500",
            padding: "12px 16px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
            maxWidth: "360px",
          },
          success: {
            iconTheme: { primary: "#16a34a", secondary: "#ffffff" },
          },
          error: {
            iconTheme: { primary: "#dc2626", secondary: "#ffffff" },
          },
        }}
      />
    </div>
  );
}
