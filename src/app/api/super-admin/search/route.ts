import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireSuperAdmin, activityActionsMatching } from "@/lib/utils/super-admin";
import type { $Enums } from "@prisma/client";

// ─── GET /api/super-admin/search?q= ──────────────────────────────────────────
// Global search across the system (§9): clients, executives/admins, visits,
// tasks, subtasks and activity, plus a direct id lookup.
//
// Every branch is capped and runs in the database — this never loads a table
// to filter it in memory. Each hit carries the entity + id the Records
// explorer needs to open it, so a result is one click from its full history.
const CAP = 6;
const like = (q: string) => ({ contains: q, mode: "insensitive" as const });

export interface SearchHit {
  entity: string;
  id: string;
  title: string;
  subtitle: string;
  kind: string;
}

export async function GET(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if (gate.response) return gate.response;

  try {
    const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
    if (q.length < 2) {
      return NextResponse.json({ query: q, hits: [], total: 0, message: "Type at least 2 characters." });
    }

    // A date query ("2026-08-13") searches visits and attendance for that day.
    const matchedActions = activityActionsMatching(q) as $Enums.ActivityAction[] | null;
    const asDate = /^\d{4}-\d{2}-\d{2}$/.test(q) ? new Date(`${q}T00:00:00.000Z`) : null;
    const dayRange = asDate
      ? { gte: asDate, lt: new Date(asDate.getTime() + 24 * 60 * 60 * 1000) }
      : null;

    const [users, clients, visits, tasks, subtasks, activity, visitsOnDay, attendanceOnDay] =
      await Promise.all([
        prisma.user.findMany({
          where: { OR: [{ name: like(q) }, { email: like(q) }, { phone: like(q) }, { id: q }] },
          select: { id: true, name: true, email: true, phone: true, role: true, isActive: true },
          take: CAP,
        }),
        prisma.client.findMany({
          where: { OR: [{ name: like(q) }, { code: like(q) }, { contactPerson: like(q) }, { id: q }] },
          select: { id: true, name: true, code: true, isArchived: true },
          take: CAP,
        }),
        prisma.visit.findMany({
          where: {
            OR: [
              { visitNumber: like(q) }, { id: q },
              { client: { name: like(q) } }, { executive: { name: like(q) } },
            ],
          },
          select: {
            id: true, visitNumber: true, status: true, scheduledDate: true,
            client: { select: { name: true } }, executive: { select: { name: true } },
          },
          orderBy: { scheduledDate: "desc" },
          take: CAP,
        }),
        prisma.task.findMany({
          where: { OR: [{ title: like(q) }, { taskType: like(q) }, { id: q }] },
          select: {
            id: true, title: true, status: true,
            visit: { select: { visitNumber: true, client: { select: { name: true } } } },
          },
          take: CAP,
        }),
        prisma.subtask.findMany({
          where: { OR: [{ title: like(q) }, { id: q }] },
          select: {
            id: true, title: true, isCompleted: true, isCarriedForward: true,
            task: { select: { visit: { select: { visitNumber: true, client: { select: { name: true } } } } } },
          },
          take: CAP,
        }),
        prisma.activityLog.findMany({
          // action is an enum column — resolved to matching values, never a
          // `contains` filter (Prisma rejects that on enums).
          where: {
            OR: [
              { user: { name: like(q) } },
              ...(matchedActions ? [{ action: { in: matchedActions } }] : []),
            ],
          },
          select: {
            id: true, action: true, createdAt: true,
            user: { select: { name: true, role: true } },
            visit: { select: { visitNumber: true } },
          },
          orderBy: { createdAt: "desc" },
          take: CAP,
        }),
        dayRange
          ? prisma.visit.findMany({
              where: { scheduledDate: dayRange },
              select: {
                id: true, visitNumber: true, status: true, scheduledDate: true,
                client: { select: { name: true } }, executive: { select: { name: true } },
              },
              take: CAP,
            })
          : Promise.resolve([]),
        dayRange
          ? prisma.attendance.findMany({
              where: { date: dayRange },
              select: {
                id: true, date: true, punchIn: true, punchOut: true,
                executive: { select: { name: true } },
              },
              take: CAP,
            })
          : Promise.resolve([]),
      ]);

    const day = (d: Date) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const hits: SearchHit[] = [
      ...users.map((u) => ({
        entity: "users", id: u.id, kind: u.role === "EXECUTIVE" ? "Executive" : u.role === "ADMIN" ? "Admin" : "Super Admin",
        title: u.name, subtitle: `${u.email}${u.phone ? ` · ${u.phone}` : ""}${u.isActive ? "" : " · inactive"}`,
      })),
      ...clients.map((c) => ({
        entity: "clients", id: c.id, kind: "Client",
        title: c.name, subtitle: `${c.code}${c.isArchived ? " · archived" : ""}`,
      })),
      ...[...visits, ...visitsOnDay].map((v) => ({
        entity: "visits", id: v.id, kind: "Visit",
        title: `${v.visitNumber} · ${v.client.name}`,
        subtitle: `${v.status} · ${day(v.scheduledDate)} · ${v.executive.name}`,
      })),
      ...tasks.map((t) => ({
        entity: "tasks", id: t.id, kind: "Task",
        title: t.title,
        subtitle: `${t.visit.visitNumber} · ${t.visit.client.name} · ${t.status}`,
      })),
      ...subtasks.map((s) => ({
        entity: s.isCarriedForward ? "carry-forward" : "subtasks", id: s.id,
        kind: s.isCarriedForward ? "Carry Forward" : "Subtask",
        title: s.title,
        subtitle: `${s.task.visit.visitNumber} · ${s.task.visit.client.name} · ${s.isCompleted ? "completed" : "pending"}`,
      })),
      ...attendanceOnDay.map((a) => ({
        entity: "attendance", id: a.id, kind: "Attendance",
        title: a.executive.name,
        subtitle: `${day(a.date)} · in ${new Date(a.punchIn).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}${a.punchOut ? "" : " · still punched in"}`,
      })),
      ...activity.map((a) => ({
        entity: "activity", id: a.id, kind: "Activity",
        title: a.action.replace(/_/g, " "),
        subtitle: `${a.user.name} · ${new Date(a.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}${a.visit ? ` · ${a.visit.visitNumber}` : ""}`,
      })),
    ];

    // De-duplicate: a visit matched by both name and date appears once.
    const seen = new Set<string>();
    const unique = hits.filter((h) => {
      const key = `${h.entity}:${h.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return NextResponse.json({ query: q, hits: unique, total: unique.length });
  } catch (error) {
    console.error("Super admin search error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
