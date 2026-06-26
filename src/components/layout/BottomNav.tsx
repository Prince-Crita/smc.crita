"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { LayoutDashboard, CheckSquare, LogOut } from "lucide-react";
import { cn } from "@/lib/utils/utils";
import toast from "react-hot-toast";

const tabs = [
  { href: "/executive", icon: LayoutDashboard, label: "Dashboard", exact: true },
  { href: "/executive/visits", icon: CheckSquare, label: "My Visits" },
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
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur-xl border-t border-slate-800 safe-bottom animate-slide-up">
      <div className="flex items-stretch h-16">
        {tabs.map(({ href, icon: Icon, label, exact }) => {
          const active = isActive(href, exact);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-1 transition-all duration-200 press-effect relative",
                active ? "text-blue-400" : "text-slate-500"
              )}
            >
              {/* Active indicator dot */}
              {active && (
                <span className="absolute top-2 w-1 h-1 rounded-full bg-blue-400 animate-scale-in" />
              )}
              <div className={cn(
                "flex items-center justify-center w-10 h-7 rounded-xl transition-all duration-200",
                active ? "bg-blue-500/15" : ""
              )}>
                <Icon className={cn(
                  "transition-all duration-200",
                  active ? "w-5 h-5" : "w-5 h-5"
                )} />
              </div>
              <span className={cn(
                "text-[10px] font-semibold tracking-wide transition-all duration-200",
                active ? "text-blue-400" : "text-slate-500"
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
          className="flex-1 flex flex-col items-center justify-center gap-1 text-slate-500 hover:text-red-400 transition-all duration-200 press-effect"
        >
          <div className="flex items-center justify-center w-10 h-7 rounded-xl">
            {loggingOut ? (
              <div className="w-4 h-4 border-2 border-slate-600 border-t-slate-400 rounded-full animate-spin" />
            ) : (
              <LogOut className="w-5 h-5" />
            )}
          </div>
          <span className="text-[10px] font-semibold tracking-wide">
            {loggingOut ? "..." : "Logout"}
          </span>
        </button>
      </div>

      {/* iOS safe area spacer */}
      <div className="h-safe-bottom bg-slate-900/95" />
    </nav>
  );
}
