"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, memo } from "react";
import toast from "react-hot-toast";
import {
  LayoutDashboard, ClipboardList, RotateCcw, LogOut, Shield,
  ChevronLeft, Menu, X, Building2, CheckSquare, UserCog, Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils/utils";

interface SidebarProps {
  userRole: "ADMIN" | "EXECUTIVE";
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
  { type: "separator", label: "Management" },
  { href: "/admin/executives", icon: UserCog, label: "Executives" },
  { href: "/admin/clients", icon: Building2, label: "Clients" },
  { href: "/admin/task-config", icon: Settings2, label: "Task Config" },
];

const executiveNavItems: NavItem[] = [
  { href: "/executive", icon: LayoutDashboard, label: "Dashboard", exact: true },
  { href: "/executive/visits", icon: CheckSquare, label: "My Visits" },
];

// ─── Nav Link ─────────────────────────────────────────────────────────────────
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
        "group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 press-effect",
        collapsed ? "justify-center" : "",
        isActive
          ? "bg-blue-600/15 text-blue-400 shadow-sm"
          : "text-slate-400 hover:text-white hover:bg-slate-800/80"
      )}
    >
      {/* Active left indicator */}
      {isActive && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-blue-400 rounded-r-full" />
      )}

      <Icon className={cn(
        "flex-shrink-0 w-[18px] h-[18px] transition-transform duration-200",
        isActive ? "text-blue-400" : "text-slate-500 group-hover:text-slate-300",
        !isActive && "group-hover:scale-110"
      )} />

      {!collapsed && (
        <span className="truncate">{item.label}</span>
      )}

      {/* Tooltip on collapsed */}
      {collapsed && (
        <span className="pointer-events-none absolute left-full ml-2 px-2.5 py-1.5 bg-slate-800 border border-slate-700 text-white text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 shadow-lg">
          {item.label}
        </span>
      )}
    </Link>
  );
});

// ─── Sidebar Content ──────────────────────────────────────────────────────────
const SidebarContent = memo(function SidebarContent({
  userRole, userName, userEmail, isCollapsed, onClose, onLogout, loggingOut, pathname,
}: {
  userRole: "ADMIN" | "EXECUTIVE";
  userName: string;
  userEmail: string;
  isCollapsed: boolean;
  onClose: () => void;
  onLogout: () => void;
  loggingOut: boolean;
  pathname: string;
}) {
  const navItems = userRole === "ADMIN" ? adminNavItems : executiveNavItems;

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  return (
    <div className="flex flex-col h-full">
      {/* Logo / Brand */}
      <div className={cn(
        "flex items-center gap-3 px-4 py-5 border-b border-slate-800/80",
        isCollapsed ? "justify-center px-3" : ""
      )}>
        <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 shadow-lg shadow-blue-600/20 flex items-center justify-center">
          <Shield className="w-5 h-5 text-white" />
        </div>
        {!isCollapsed && (
          <div className="min-w-0 animate-in">
            <p className="text-sm font-bold text-white leading-tight">SMC Audit</p>
            <p className="text-xs text-slate-500 leading-tight mt-0.5">Task Management</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto no-scrollbar">
        {!isCollapsed && (
          <p className="px-3 mb-2 mt-1 text-[10px] font-bold text-slate-600 uppercase tracking-widest">
            {userRole === "ADMIN" ? "Administration" : "Field Operations"}
          </p>
        )}

        {navItems.map((item, idx) => {
          if ("type" in item && item.type === "separator") {
            if (isCollapsed) {
              return (
                <div key={idx} className="my-2 mx-3 border-t border-slate-800/60" />
              );
            }
            return (
              <p key={idx} className="px-3 pt-4 pb-1 text-[10px] font-bold text-slate-600 uppercase tracking-widest">
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
      <div className={cn("border-t border-slate-800/80", isCollapsed ? "p-2" : "p-3")}>
        {!isCollapsed && (
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-800/40 border border-slate-700/30 mb-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 shadow-sm">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate leading-tight">{userName}</p>
              <p className="text-xs text-slate-500 truncate mt-0.5">{userEmail}</p>
            </div>
          </div>
        )}

        <button
          onClick={onLogout}
          disabled={loggingOut}
          id="logout-btn"
          title={isCollapsed ? "Logout" : undefined}
          className={cn(
            "group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 press-effect",
            "text-slate-500 hover:text-red-400 hover:bg-red-400/8",
            isCollapsed ? "justify-center" : ""
          )}
        >
          <LogOut className={cn(
            "flex-shrink-0 w-[18px] h-[18px] transition-colors",
            "group-hover:text-red-400"
          )} />
          {!isCollapsed && (
            <span>{loggingOut ? "Logging out…" : "Log Out"}</span>
          )}
          {isCollapsed && (
            <span className="pointer-events-none absolute left-full ml-2 px-2.5 py-1.5 bg-slate-800 border border-slate-700 text-white text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 shadow-lg">
              Log Out
            </span>
          )}
        </button>
      </div>
    </div>
  );
});

// ─── Main Sidebar ─────────────────────────────────────────────────────────────
export default function Sidebar({ userRole, userName, userEmail }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // For admins on mobile we keep the hamburger; executives get bottom nav instead
  const isMobileNavVisible = userRole === "ADMIN";

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
      {/* ── Mobile hamburger (Admin only) ── */}
      {isMobileNavVisible && (
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="lg:hidden fixed top-3.5 left-4 z-50 p-2 rounded-lg bg-slate-900/90 border border-slate-700/80 text-slate-400 hover:text-white backdrop-blur-sm transition-colors press-effect"
          aria-label="Toggle menu"
        >
          {mobileOpen
            ? <X className="w-5 h-5" />
            : <Menu className="w-5 h-5" />
          }
        </button>
      )}

      {/* ── Mobile overlay (Admin only) ── */}
      {isMobileNavVisible && mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Mobile sidebar drawer (Admin only) ── */}
      {isMobileNavVisible && (
        <aside className={cn(
          "lg:hidden fixed left-0 top-0 bottom-0 z-50 w-72 bg-slate-900 border-r border-slate-800 transition-transform duration-300 ease-out",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}>
          <SidebarContent
            userRole={userRole}
            userName={userName}
            userEmail={userEmail}
            isCollapsed={false}
            onClose={() => setMobileOpen(false)}
            onLogout={handleLogout}
            loggingOut={loggingOut}
            pathname={pathname}
          />
        </aside>
      )}

      {/* ── Desktop sidebar (all roles) ── */}
      <aside className={cn(
        "hidden lg:flex flex-col fixed left-0 top-0 bottom-0 bg-slate-900 border-r border-slate-800 transition-all duration-300 ease-out z-30",
        isCollapsed ? "w-[60px]" : "w-64"
      )}>
        {/* Collapse toggle */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={cn(
            "absolute -right-3 top-6 z-10",
            "w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center",
            "text-slate-400 hover:text-white hover:bg-slate-700 transition-all duration-200 shadow-md press-effect"
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

      {/* ── Desktop spacer ── */}
      <div className={cn(
        "hidden lg:block flex-shrink-0 transition-all duration-300",
        isCollapsed ? "w-[60px]" : "w-64"
      )} />
    </>
  );
}
