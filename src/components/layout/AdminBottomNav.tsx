"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  ClipboardList,
  UserCog,
  Building2,
  MoreHorizontal,
  Settings2,
  RotateCcw,
  LogOut,
  X,
  Clock,
  FileText,
  CalendarDays,
} from "lucide-react";
import { cn } from "@/lib/utils/utils";
import toast from "react-hot-toast";

// ─── Primary tabs (always visible in the bottom bar) ──────────────────────────
const primaryTabs = [
  { href: "/admin",            icon: LayoutDashboard, label: "Dashboard", exact: true  },
  { href: "/admin/visits",     icon: ClipboardList,   label: "Visits",    exact: false },
  { href: "/admin/calendar",   icon: CalendarDays,    label: "Calendar",  exact: false },
  { href: "/admin/executives", icon: UserCog,         label: "Executives",exact: false },
];

// ─── Secondary items (inside the "Menu" bottom sheet) ──────────────────────────────────
const menuItems = [
  { href: "/admin/clients",       icon: Building2,  label: "Clients"         },
  { href: "/admin/task-config",   icon: Settings2,  label: "Task Config"     },
  { href: "/admin/carry-forward", icon: RotateCcw,  label: "Carry Forward"   },
  { href: "/admin/attendance",    icon: Clock,      label: "Attendance"      },
  { href: "/admin/leaves",        icon: FileText,   label: "Leave Approvals" },
];

// Routes that belong to the menu sheet — used to detect if the sheet trigger
// itself should appear "active" when the user is on one of these pages.
const menuRoutes = menuItems.map((m) => m.href);

export default function AdminBottomNav() {
  const pathname    = usePathname();
  const router      = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // Close sheet on route change
  useEffect(() => { setSheetOpen(false); }, [pathname]);

  // Lock body scroll while sheet is open
  useEffect(() => {
    if (sheetOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [sheetOpen]);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  // "Menu" tab is active when the current page lives inside the sheet
  const menuActive = menuRoutes.some((r) => pathname.startsWith(r));

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setSheetOpen(false);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      toast.success("Logged out");
      router.push("/login");
    } catch {
      router.push("/login");
    }
  };

  const handleMenuLink = (href: string) => {
    setSheetOpen(false);
    router.push(href);
  };

  return (
    <>
      {/* ── Bottom navigation bar ─────────────────────────────────────────── */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-[#e2e7f0] shadow-[0_-4px_20px_rgba(0,0,0,0.06)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-stretch h-16">
          {/* Primary tabs */}
          {primaryTabs.map(({ href, icon: Icon, label, exact }) => {
            const active = isActive(href, exact);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex-1 flex flex-col items-center justify-center gap-1",
                  "transition-all duration-200 press-effect relative select-none",
                  active ? "text-[#25488e]" : "text-[#8896a9]"
                )}
              >
                {/* Active top pill */}
                {active && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-[#25488e]" />
                )}

                <div className={cn(
                  "flex items-center justify-center w-10 h-7 rounded-xl transition-all duration-200",
                  active ? "bg-[#eef2f9]" : ""
                )}>
                  <Icon className="w-[18px] h-[18px]" />
                </div>

                <span className={cn(
                  "text-[10px] font-semibold tracking-wide leading-none",
                  active ? "text-[#25488e]" : "text-[#8896a9]"
                )}>
                  {label}
                </span>
              </Link>
            );
          })}

          {/* Menu tab */}
          <button
            onClick={() => setSheetOpen(true)}
            className={cn(
              "flex-1 flex flex-col items-center justify-center gap-1",
              "transition-all duration-200 press-effect relative select-none",
              menuActive ? "text-[#25488e]" : "text-[#8896a9]"
            )}
          >
            {menuActive && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-[#25488e]" />
            )}

            <div className={cn(
              "flex items-center justify-center w-10 h-7 rounded-xl transition-all duration-200",
              menuActive ? "bg-[#eef2f9]" : ""
            )}>
              <MoreHorizontal className="w-[18px] h-[18px]" />
            </div>

            <span className={cn(
              "text-[10px] font-semibold tracking-wide leading-none",
              menuActive ? "text-[#25488e]" : "text-[#8896a9]"
            )}>
              Menu
            </span>
          </button>
        </div>
      </nav>

      {/* ── Bottom Sheet Backdrop ─────────────────────────────────────────── */}
      <div
        onClick={() => setSheetOpen(false)}
        className={cn(
          "lg:hidden fixed inset-0 z-[60] bg-[#0f1829]/40 backdrop-blur-sm",
          "transition-all duration-300",
          sheetOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        aria-hidden="true"
      />

      {/* ── Bottom Sheet ──────────────────────────────────────────────────── */}
      <div
        className={cn(
          "lg:hidden fixed bottom-0 left-0 right-0 z-[70]",
          "bg-white rounded-t-2xl shadow-[0_-8px_40px_rgba(0,0,0,0.14)]",
          "transition-transform duration-300 ease-out",
          sheetOpen ? "translate-y-0" : "translate-y-full"
        )}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* Drag handle */}
        <div className="flex items-center justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-[#e2e7f0]" />
        </div>

        {/* Sheet header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#f1f4f9]">
          <p className="text-sm font-bold text-[#0f1829]">More Options</p>
          <button
            onClick={() => setSheetOpen(false)}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#4a5568] transition-colors press-effect"
            aria-label="Close menu"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sheet nav items */}
        <div className="px-3 py-3 space-y-1">
          {menuItems.map(({ href, icon: Icon, label }) => {
            const active = isActive(href, false);
            return (
              <button
                key={href}
                onClick={() => handleMenuLink(href)}
                className={cn(
                  "w-full flex items-center gap-4 px-4 py-3.5 rounded-xl",
                  "text-left transition-all duration-150 press-effect",
                  active
                    ? "bg-[#eef2f9] text-[#25488e]"
                    : "text-[#4a5568] hover:bg-[#f8f9fc]"
                )}
              >
                <div className={cn(
                  "w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0",
                  active ? "bg-[#25488e] text-white" : "bg-[#f1f4f9] text-[#8896a9]"
                )}>
                  <Icon className="w-[18px] h-[18px]" />
                </div>
                <span className={cn(
                  "text-sm font-semibold",
                  active ? "text-[#25488e]" : "text-[#0f1829]"
                )}>
                  {label}
                </span>
                {/* Active indicator dot */}
                {active && (
                  <span className="ml-auto w-2 h-2 rounded-full bg-[#25488e]" />
                )}
              </button>
            );
          })}
        </div>

        {/* Divider */}
        <div className="mx-5 border-t border-[#f1f4f9]" />

        {/* Logout */}
        <div className="px-3 py-3">
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl text-left transition-all duration-150 press-effect group text-[#800040] hover:bg-[#fff0f6] disabled:opacity-60"
          >
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-[#fff0f6] group-hover:bg-[#ffe0ed] transition-colors">
              {loggingOut ? (
                <div className="w-4 h-4 border-2 border-[#ffadd1] border-t-[#800040] rounded-full animate-spin" />
              ) : (
                <LogOut className="w-[18px] h-[18px]" />
              )}
            </div>
            <span className="text-sm font-semibold">
              {loggingOut ? "Signing out…" : "Sign Out"}
            </span>
          </button>
        </div>
      </div>
    </>
  );
}
