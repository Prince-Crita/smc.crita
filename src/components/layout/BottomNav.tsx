"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { LayoutDashboard, CheckSquare, CalendarDays, Clock, LogOut } from "lucide-react";
import { cn } from "@/lib/utils/utils";
import toast from "react-hot-toast";

const tabs = [
  { href: "/executive",          icon: LayoutDashboard, label: "Home",     exact: true  },
  { href: "/executive/calendar", icon: CalendarDays,    label: "Calendar", exact: false },
  { href: "/executive/visits",   icon: CheckSquare,     label: "Visits",   exact: false },
  { href: "/executive/leave",    icon: Clock,           label: "Leave",    exact: false },
];

export default function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      toast.success("Logged out");
      router.push("/login");
    } catch {
      router.push("/login");
    }
  };

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-[#e2e7f0] shadow-lg"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-stretch h-16">
        {tabs.map(({ href, icon: Icon, label, exact }) => {
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

        {/* Logout tab */}
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="flex-1 flex flex-col items-center justify-center gap-1 text-[#8896a9] hover:text-red-500 transition-all duration-200 press-effect select-none"
        >
          <div className="flex items-center justify-center w-10 h-7 rounded-xl">
            {loggingOut ? (
              <div className="w-4 h-4 border-2 border-[#c8d2e0] border-t-[#25488e] rounded-full animate-spin" />
            ) : (
              <LogOut className="w-[18px] h-[18px]" />
            )}
          </div>
          <span className="text-[10px] font-semibold tracking-wide leading-none">
            {loggingOut ? "…" : "Logout"}
          </span>
        </button>
      </div>
    </nav>
  );
}
