import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireSuperAdmin, paging } from "@/lib/utils/super-admin";
import { undoOperation, undoWindow, redoOperation } from "@/lib/utils/admin-operations";

// ─── GET /api/super-admin/operations ─────────────────────────────────────────
// The audit trail (§4): who did what, to which entity, what the values were
// before and after, whether it can still be reversed, and — once reversed —
// who undid it and when. SUPER ADMIN ONLY; a normal ADMIN gets 403.
//
// Query: ?minutes=15|30  ?entityType=  ?userId=  ?state=reversible|undone|irreversible
//        ?q=  ?page=  ?pageSize=
export async function GET(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if (gate.response) return gate.response;

  try {
    const { searchParams } = new URL(request.url);
    const minutes = Number(searchParams.get("minutes")) || 0;
    const entityType = searchParams.get("entityType") ?? "";
    const userId = searchParams.get("userId") ?? "";
    const state = searchParams.get("state") ?? "";
    const q = (searchParams.get("q") ?? "").trim();
    const { page, pageSize, skip } = paging(searchParams);

    const where: Record<string, unknown> = {};
    if (minutes > 0) where.createdAt = { gte: new Date(Date.now() - minutes * 60_000) };
    if (entityType) where.entityType = entityType;
    if (userId) where.userId = userId;
    if (state === "reversible") { where.isReversible = true; where.undoneAt = null; }
    if (state === "undone") where.undoneAt = { not: null };
    if (state === "irreversible") where.isReversible = false;
    if (q) {
      where.OR = [
        { summary: { contains: q, mode: "insensitive" as const } },
        { action: { contains: q.toUpperCase().replace(/ /g, "_") } },
        { reason: { contains: q, mode: "insensitive" as const } },
        { entityId: q },
      ];
    }

    const [ops, total] = await prisma.$transaction([
      prisma.adminOperation.findMany({
        where,
        select: {
          id: true, action: true, entityType: true, entityId: true, summary: true,
          reason: true, beforeJson: true, afterJson: true, isReversible: true,
          undoneAt: true, createdAt: true,
          user: { select: { id: true, name: true, role: true } },
          undoneBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip, take: pageSize,
      }),
      prisma.adminOperation.count({ where }),
    ]);

    // Which undone operations may still be re-applied. Resolved in ONE query
    // for the whole page rather than per row.
    const undoneIds = ops.filter((o) => o.undoneAt && o.isReversible).map((o) => o.id);
    const standingRedos = undoneIds.length
      ? await prisma.adminOperation.findMany({
          where: { action: "SUPER_ADMIN_REDO", undoneAt: null },
          select: { afterJson: true },
        })
      : [];
    const redone = new Set(
      standingRedos
        .map((r) => (r.afterJson as { __redoOf?: string } | null)?.__redoOf)
        .filter((v): v is string => typeof v === "string")
    );

    return NextResponse.json({
      operations: ops.map((o) => ({
        ...o,
        canUndo: o.isReversible && !o.undoneAt,
        canRedo: o.isReversible && !!o.undoneAt && !redone.has(o.id),
        // §6 — the operation's honest reversibility class, shown as-is in the
        // UI so a destructive action is never presented as recoverable.
        reversibility: o.isReversible ? "reversible" : "not-reversible",
      })),
      total, page, pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (error) {
    console.error("Super admin operations error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST /api/super-admin/operations ────────────────────────────────────────
// Recovery (§5). Body is one of:
//   { operationId, reason? }              - undo one specific operation
//   { redoOperationId, reason? }          - re-apply an operation that was undone
//   { scope: "last", reason? }            - undo the most recent reversible operation
//   { scope: "minutes", minutes: 15|30 }  - undo everything reversible in the window
export async function POST(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if (gate.response) return gate.response;
  const actor = gate.user!;

  try {
    const body = await request.json().catch(() => ({})) as {
      operationId?: string;
      redoOperationId?: string;
      scope?: "last" | "minutes";
      minutes?: number;
      reason?: string;
    };

    if (body.redoOperationId) {
      const res = await redoOperation(body.redoOperationId, actor.userId, body.reason);
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
      return NextResponse.json({ success: true, redone: 1, reapplied: res.reapplied });
    }

    if (body.operationId) {
      const res = await undoOperation(body.operationId, actor.userId, body.reason);
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
      return NextResponse.json({ success: true, undone: 1, restored: res.restored });
    }

    if (body.scope === "last") {
      const last = await prisma.adminOperation.findFirst({
        where: { undoneAt: null, isReversible: true },
        orderBy: { createdAt: "desc" },
      });
      if (!last) return NextResponse.json({ error: "There is no reversible operation to undo." }, { status: 404 });
      const res = await undoOperation(last.id, actor.userId, body.reason);
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
      return NextResponse.json({ success: true, undone: 1, operation: last.summary, restored: res.restored });
    }

    if (body.scope === "minutes") {
      const minutes = Number(body.minutes);
      if (![15, 30].includes(minutes)) {
        return NextResponse.json({ error: "minutes must be 15 or 30" }, { status: 400 });
      }
      const res = await undoWindow(minutes, actor.userId, body.reason);
      return NextResponse.json({ success: true, ...res });
    }

    return NextResponse.json(
      { error: "Provide operationId, redoOperationId, or scope 'last' | 'minutes'." },
      { status: 400 }
    );
  } catch (error) {
    console.error("Super admin recovery error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
