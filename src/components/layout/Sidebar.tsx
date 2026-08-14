"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState, memo } from "react";
import toast from "react-hot-toast";
import {
  LayoutDashboard, ClipboardList, RotateCcw, LogOut,
  ChevronLeft, Building2, CheckSquare, UserCog, Settings2,
  CalendarDays, Clock, FileText, ShieldCheck, Undo2,
  Gauge, Database, HeartPulse,
} from "lucide-react";
import { cn } from "@/lib/utils/utils";
import { isAdminRole } from "@/lib/auth/roles";

interface SidebarProps {
  userRole: "ADMIN" | "EXECUTIVE" | "SUPER_ADMIN";
  userName: string;
  userEmail: string;
}

type NavItem =
  | { type: "separator"; label: string }
  | { href: string; icon: React.ElementType; label: string; exact?: boolean };

const adminNavItems: NavItem[] = [
  { href: "/admin", icon: LayoutDashboard, label: "Dashboard", exact: true },
  { href: "/admin/visits", icon: ClipboardList, label: "All Visits" },
  { href: "/admin/carry-forward", icon: RotateCcw, label: "Carry Forward" },
  { href: "/admin/calendar", icon: CalendarDays, label: "Calendar" },
  { type: "separator", label: "Management" },
  { href: "/admin/executives", icon: UserCog, label: "Executives" },
  { href: "/admin/clients", icon: Building2, label: "Clients" },
  { href: "/admin/task-config", icon: Settings2, label: "Task Config" },
  { type: "separator", label: "HR & Operations" },
  { href: "/admin/attendance", icon: Clock, label: "Attendance" },
  { href: "/admin/leaves", icon: FileText, label: "Leave Approvals" },
];

// Super Admin keeps every Admin screen and adds the system-control layer.
// Each of these routes is SUPER_ADMIN-gated server-side AND by its own API;
// these links only keep them out of a normal admin's navigation.
const superAdminNavItems: NavItem[] = [
  ...adminNavItems,
  { type: "separator", label: "Super Admin" },
  { href: "/admin/system", icon: Gauge, label: "System Overview" },
  { href: "/admin/records", icon: Database, label: "Records" },
  { href: "/admin/system-health", icon: HeartPulse, label: "Data Integrity" },
  { href: "/admin/control-panel", icon: Undo2, label: "Control Panel" },
  { href: "/admin/admin-management", icon: ShieldCheck, label: "Admin Management" },
];

const executiveNavItems: NavItem[] = [
  { href: "/executive", icon: LayoutDashboard, label: "Dashboard", exact: true },
  { href: "/executive/calendar", icon: CalendarDays, label: "Calendar" },
  { href: "/executive/visits", icon: CheckSquare, label: "My Visits" },
  { href: "/executive/leave", icon: Clock, label: "Attendance & Leave" },
];

// --- Nav Link -------------------------------------------------------------------
const NavLink = memo(function NavLink({
  item,
  isActive,
  collapsed,
  onClick,
}: {
  item: Extract<NavItem, { href: string }>;
  isActive: boolean;
  collapsed: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      className={cn(
        "group relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 press-effect",
        collapsed ? "justify-center" : "",
        isActive
          ? "bg-white/15 text-white shadow-sm"
          : "text-white/60 hover:text-white hover:bg-white/10"
      )}
    >
      {/* Active left indicator bar */}
      {isActive && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-[#ff944d] rounded-r-full" />
      )}

      <Icon className={cn(
        "flex-shrink-0 w-[18px] h-[18px] transition-transform duration-200",
        isActive ? "text-white" : "text-white/50 group-hover:text-white",
        !isActive && "group-hover:scale-105"
      )} />

      {!collapsed && (
        <span className="truncate">{item.label}</span>
      )}

      {/* Collapsed tooltip */}
      {collapsed && (
        <span className="pointer-events-none absolute left-full ml-3 px-3 py-1.5 bg-[#0f1829] text-white text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 shadow-xl border border-white/10">
          {item.label}
        </span>
      )}
    </Link>
  );
});

// --- Sidebar Logo -----------------------------------------------------------------
// Desktop-only (Sidebar itself is `hidden lg:flex`). A soft white rounded
// container sits behind the logo purely for contrast against the dark navy
// sidebar - the logo asset itself is untouched (no recolor/crop/stretch).
function SidebarLogo({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={cn(
      "flex items-center justify-center border-b border-white/10",
      collapsed ? "px-2 py-4" : "px-4 py-5"
    )}>
      {collapsed ? (
        /* Collapsed: white rounded badge, logo scaled down, no crop */
        <div className="w-full bg-white rounded-lg shadow-sm px-1.5 py-1.5 flex items-center justify-center">
          <Image
            src="/logo.png"
            alt="Shaabi Management Consultancy"
            width={600}
            height={200}
            className="object-contain w-full h-auto"
            priority
          />
        </div>
      ) : (
        /* Expanded: white rounded container, full horizontal logo centered */
        <div className="w-full bg-white rounded-xl shadow-sm px-4 py-3 flex items-center justify-center">
          <Image
            src="/logo.png"
            alt="Shaabi Management Consultancy"
            width={600}
            height={200}
            className="object-contain h-12 w-auto"
            priority
          />
        </div>
      )}
    </div>
  );
}

// --- Sidebar Content --------------------------------------------------------------
const SidebarContent = memo(function SidebarContent({
  userRole, userName, userEmail, isCollapsed, onClose, onLogout, loggingOut, pathname,
}: {
  userRole: "ADMIN" | "EXECUTIVE" | "SUPER_ADMIN";
  userName: string;
  userEmail: string;
  isCollapsed: boolean;
  onClose: () => void;
  onLogout: () => void;
  loggingOut: boolean;
  pathname: string;
}) {
  const navItems =
    userRole === "SUPER_ADMIN" ? superAdminNavItems : userRole === "ADMIN" ? adminNavItems : executiveNavItems;

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  return (
    <div className="flex flex-col h-full">
      <SidebarLogo collapsed={isCollapsed} />

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto no-scrollbar">
        {!isCollapsed && (
          <p className="px-3 mb-3 text-[10px] font-bold text-white/30 uppercase tracking-widest">
            {isAdminRole(userRole) ? "Main Menu" : "Field Operations"}
          </p>
        )}

        {navItems.map((item, idx) => {
          if ("type" in item && item.type === "separator") {
            if (isCollapsed) {
              return (
                <div key={idx} className="my-3 mx-3 border-t border-white/10" />
              );
            }
            return (
              <p key={idx} className="px-3 pt-5 pb-2 text-[10px] font-bold text-white/30 uppercase tracking-widest">
                {item.label}
              </p>
            );
          }

          const navItem = item as Extract<NavItem, { href: string }>;
          return (
            <NavLink
              key={navItem.href}
              item={navItem}
              isActive={isActive(navItem.href, navItem.exact)}
              collapsed={isCollapsed}
              onClick={onClose}
            />
          );
        })}
      </nav>

      {/* User profile + logout */}
      <div className={cn("border-t border-white/10", isCollapsed ? "p-2" : "p-3")}>
        {!isCollapsed && (
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/10 mb-2">
            <div className="w-8 h-8 rounded-full bg-[#ff944d] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate leading-tight">{userName}</p>
              <p className="text-xs text-white/40 truncate mt-0.5">
                {userRole === "SUPER_ADMIN" ? "Super Admin" : userRole === "ADMIN" ? "Admin" : "Executive"}
              </p>
            </div>
          </div>
        )}

        <button
          onClick={onLogout}
          disabled={loggingOut}
          id="logout-btn"
          title={isCollapsed ? "Logout" : undefined}
          className={cn(
            "group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 press-effect",
            "text-white/40 hover:text-white hover:bg-white/10",
            isCollapsed ? "justify-center" : ""
          )}
        >
          <LogOut className="flex-shrink-0 w-[18px] h-[18px] transition-colors group-hover:text-red-400" />
          {!isCollapsed && (
            <span>{loggingOut ? "Logging out…" : "Sign Out"}</span>
          )}
          {isCollapsed && (
            <span className="pointer-events-none absolute left-full ml-3 px-3 py-1.5 bg-[#0f1829] text-white text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 shadow-xl border border-white/10">
              Sign Out
            </span>
          )}
        </button>
      </div>
    </div>
  );
});

// --- Main Sidebar -------------------------------------------------------------
export default function Sidebar({ userRole, userName, userEmail }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      toast.success("Logged out successfully");
      router.push("/login");
    } catch {
      router.push("/login");
    }
  };

  return (
    <>
      <aside className={cn(
        "hidden lg:flex flex-col fixed left-0 top-0 bottom-0 transition-all duration-300 ease-out z-30",
        "bg-[#172d58]",
        isCollapsed ? "w-[60px]" : "w-64"
      )}>
        {/* Collapse toggle */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={cn(
            "absolute -right-3 top-6 z-10",
            "w-6 h-6 rounded-full bg-white border border-[#e2e7f0] flex items-center justify-center",
            "text-[#25488e] hover:bg-[#eef2f9] transition-all duration-200 shadow-md press-effect"
          )}
          aria-label="Toggle sidebar"
        >
          <ChevronLeft className={cn(
            "w-3.5 h-3.5 transition-transform duration-300",
            isCollapsed && "rotate-180"
          )} />
        </button>

        <SidebarContent
          userRole={userRole}
          userName={userName}
          userEmail={userEmail}
          isCollapsed={isCollapsed}
          onClose={() => {}}
          onLogout={handleLogout}
          loggingOut={loggingOut}
          pathname={pathname}
        />
      </aside>

      {/* -- Desktop spacer -- */}
      <div className={cn(
        "hidden lg:block flex-shrink-0 transition-all duration-300",
        isCollapsed ? "w-[60px]" : "w-64"
      )} />
    </>
  );
}
