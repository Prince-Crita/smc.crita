"use client";

/**
 * Super Admin → System Overview (§1).
 *
 * A SYSTEM-level view, not a second copy of the admin dashboard: who is in
 * the system, what is in flight, what changed recently, who is still punched
 * in, and which recorded operations can no longer be reversed. Operational
 * visit progress and charts stay where they already are, on the admin
 * dashboard.
 *
 * Every tile links into the Records explorer with the matching filter, so the
 * overview is a way in rather than a dead end.
 */
import { useCallback } from "react";
import Link from "next/link";
import {
  ShieldCheck, Users, Building2, ClipboardList, RotateCcw, Clock,
  Activity, History, AlertTriangle, ArrowRight,
} from "lucide-react";
import { useLiveQuery, fetchJSON } from "@/lib/hooks/useLiveQuery";
import { SkeletonStat, SkeletonCard } from "@/components/ui/Skeleton";
import { GlobalSearch } from "@/components/super-admin/GlobalSearch";
import { StatTile, Panel, Pill, AccessDenied, fmtDateTime, humanAction } from "@/components/super-admin/shared";

interface Overview {
  users: { admins: number; superAdmins: number; executives: number; active: number; inactive: number; total: number };
  clients: { total: number; active: number; archived: number };
  visits: { total: number; pending: number; inProgress: number; closed: number; cancelled: number };
  carryForward: { pendingApproval: number; stillPending: number; rejected: number; total: number };
  attendance: {
    today: number; punchedIn: number;
    currentlyIn: { id: string; punchIn: string; isLate: boolean; executive: { id: string; name: string } }[];
  };
  leaves: { pending: number; total: number };
  operations: {
    notReversible: number;
    recent: {
      id: string; action: string; entityType: string; entityId: string; summary: string;
      reason: string | null; isReversible: boolean; undoneAt: string | null; createdAt: string;
      user: { id: string; name: string; role: string };
    }[];
  };
  activity: {
    admin: ActivityRow[];
    executive: ActivityRow[];
  };
}

interface ActivityRow {
  id: string;
  action: string;
  createdAt: string;
  user: { id: string; name: string; role: string };
  visit: { visitNumber: string; client: { name: string } } | null;
}

const time = (d: string) =>
  new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

export function SystemOverviewClient() {
  const { data, loading, error } = useLiveQuery(
    useCallback(() => fetchJSON<Overview>("/api/super-admin/overview"), [])
  );

  if (error && String(error).includes("403")) return <AccessDenied title="System Overview" />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-[#0f1829] flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-[#25488e]" /> System Overview
        </h1>
        <p className="text-[#8896a9] text-sm mt-1">
          System-wide state, recent changes and recovery status across Admin and Executive.
        </p>
      </div>

      <GlobalSearch />

      {loading && !data ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonStat key={i} />)}
          </div>
          <SkeletonCard />
        </>
      ) : !data ? null : (
        <>
          {/* People */}
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wide text-[#8896a9] mb-2">People</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatTile label="Admins" value={data.users.admins} tone="primary" href="/admin/records?entity=users&q=" />
              <StatTile label="Super Admins" value={data.users.superAdmins} />
              <StatTile label="Executives" value={data.users.executives} tone="primary" href="/admin/records?entity=users" />
              <StatTile label="Active users" value={data.users.active} tone="good" href="/admin/records?entity=users&status=ACTIVE" />
              <StatTile
                label="Inactive users" value={data.users.inactive}
                tone={data.users.inactive > 0 ? "warn" : "default"}
                href="/admin/records?entity=users&status=INACTIVE"
              />
              <StatTile label="Total users" value={data.users.total} />
            </div>
          </div>

          {/* Clients & visits */}
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wide text-[#8896a9] mb-2">Clients &amp; Visits</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatTile label="Total clients" value={data.clients.total} href="/admin/records?entity=clients" />
              <StatTile label="Active clients" value={data.clients.active} tone="good" href="/admin/records?entity=clients&status=ACTIVE" />
              <StatTile label="Total visits" value={data.visits.total} href="/admin/records?entity=visits" />
              <StatTile label="Pending" value={data.visits.pending} tone="warn" href="/admin/records?entity=visits&status=PENDING" />
              <StatTile label="In progress" value={data.visits.inProgress} tone="primary" href="/admin/records?entity=visits&status=OPEN" />
              <StatTile label="Closed" value={data.visits.closed} tone="good" href="/admin/records?entity=visits&status=CLOSED" />
            </div>
          </div>

          {/* Carry forward, attendance, leave */}
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wide text-[#8896a9] mb-2">
              Carry Forward, Attendance &amp; Leave
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatTile
                label="CF pending approval" value={data.carryForward.pendingApproval}
                tone={data.carryForward.pendingApproval > 0 ? "warn" : "default"}
                href="/admin/records?entity=carry-forward&status=REQUESTED"
              />
              <StatTile
                label="CF still pending" value={data.carryForward.stillPending}
                href="/admin/records?entity=carry-forward&status=CARRIED"
              />
              <StatTile label="Attendance today" value={data.attendance.today} href="/admin/records?entity=attendance" />
              <StatTile
                label="Punched in now" value={data.attendance.punchedIn} tone="good"
                hint={data.attendance.punchedIn > 0 ? "currently working" : undefined}
              />
              <StatTile
                label="Leave pending" value={data.leaves.pending}
                tone={data.leaves.pending > 0 ? "warn" : "default"}
                href="/admin/records?entity=leaves&status=PENDING"
              />
              <StatTile
                label="Not reversible" value={data.operations.notReversible}
                tone={data.operations.notReversible > 0 ? "danger" : "default"}
                hint="recorded, cannot be undone"
                href="/admin/control-panel?state=irreversible"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Recent system changes */}
            <Panel
              title="Recent system changes" icon={History} count={data.operations.recent.length}
              actions={
                <Link href="/admin/control-panel" className="text-[11px] font-semibold text-[#25488e] hover:underline flex items-center gap-1">
                  Control Panel <ArrowRight className="w-3 h-3" />
                </Link>
              }
            >
              {data.operations.recent.length === 0 ? (
                <p className="px-4 py-8 text-sm text-[#8896a9] text-center">No administrative changes recorded yet.</p>
              ) : (
                <ul className="divide-y divide-[#f1f4f9] max-h-[340px] overflow-y-auto overscroll-contain">
                  {data.operations.recent.map((op) => (
                    <li key={op.id} className="px-4 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-[#0f1829] break-words min-w-0">{op.summary}</p>
                        {op.undoneAt ? <Pill tone="good">Undone</Pill>
                          : op.isReversible ? <Pill tone="primary">Reversible</Pill>
                          : <Pill tone="danger">Not reversible</Pill>}
                      </div>
                      <div className="flex flex-wrap gap-x-3 text-[11px] text-[#8896a9] mt-0.5">
                        <span>{op.user.name} ({op.user.role})</span>
                        <span>{fmtDateTime(op.createdAt)}</span>
                      </div>
                      {op.reason && <p className="text-[11px] text-[#4a5568] mt-0.5 italic">Reason: {op.reason}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {/* Currently punched in */}
            <Panel title="Currently punched in" icon={Clock} count={data.attendance.currentlyIn.length}>
              {data.attendance.currentlyIn.length === 0 ? (
                <p className="px-4 py-8 text-sm text-[#8896a9] text-center">Nobody is punched in right now.</p>
              ) : (
                <ul className="divide-y divide-[#f1f4f9] max-h-[340px] overflow-y-auto overscroll-contain">
                  {data.attendance.currentlyIn.map((a) => (
                    <li key={a.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                      <Link
                        href={`/admin/records?entity=users&id=${a.executive.id}`}
                        className="text-sm font-semibold text-[#0f1829] hover:text-[#25488e] truncate"
                      >
                        {a.executive.name}
                      </Link>
                      <span className="flex items-center gap-2 flex-shrink-0">
                        {a.isLate && <Pill tone="warn">Late</Pill>}
                        <span className="text-[11px] text-[#8896a9]">in {time(a.punchIn)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {/* Admin actions */}
            <Panel title="Recent Admin actions" icon={Users} count={data.activity.admin.length}>
              <ActivityList rows={data.activity.admin} empty="No recent admin activity." />
            </Panel>

            {/* Executive actions */}
            <Panel title="Recent Executive actions" icon={Activity} count={data.activity.executive.length}>
              <ActivityList rows={data.activity.executive} empty="No recent executive activity." />
            </Panel>
          </div>

          {/* Quick links */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <QuickLink href="/admin/records?entity=visits" icon={ClipboardList} label="Records" hint="Inspect & correct" />
            <QuickLink href="/admin/system-health" icon={AlertTriangle} label="Data Integrity" hint="Diagnostics" />
            <QuickLink href="/admin/control-panel" icon={RotateCcw} label="Control Panel" hint="Audit & recovery" />
            <QuickLink href="/admin/records?entity=clients" icon={Building2} label="Clients" hint="Config & history" />
          </div>
        </>
      )}
    </div>
  );
}

function ActivityList({ rows, empty }: { rows: ActivityRow[]; empty: string }) {
  if (rows.length === 0) {
    return <p className="px-4 py-8 text-sm text-[#8896a9] text-center">{empty}</p>;
  }
  return (
    <ul className="divide-y divide-[#f1f4f9] max-h-[340px] overflow-y-auto overscroll-contain">
      {rows.map((a) => (
        <li key={a.id} className="px-4 py-2.5">
          <p className="text-sm font-semibold text-[#0f1829] truncate">{humanAction(a.action)}</p>
          <div className="flex flex-wrap gap-x-3 text-[11px] text-[#8896a9] mt-0.5">
            <Link href={`/admin/records?entity=users&id=${a.user.id}`} className="hover:text-[#25488e] font-medium">
              {a.user.name}
            </Link>
            <span>{fmtDateTime(a.createdAt)}</span>
            {a.visit && <span className="truncate">{a.visit.visitNumber} · {a.visit.client.name}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function QuickLink({
  href, icon: Icon, label, hint,
}: { href: string; icon: React.ElementType; label: string; hint: string }) {
  return (
    <Link
      href={href}
      className="bg-white border border-[#e2e7f0] rounded-xl p-3.5 hover:border-[#25488e]/50 hover:bg-[#f8fafc] transition-colors press-effect min-w-0"
    >
      <Icon className="w-4 h-4 text-[#25488e] mb-1.5" />
      <p className="text-sm font-bold text-[#0f1829] truncate">{label}</p>
      <p className="text-[11px] text-[#8896a9] truncate">{hint}</p>
    </Link>
  );
}
