/**
 * Super Admin — shared server-side helpers (§7, §12).
 *
 * Two responsibilities:
 *
 *  1. `requireSuperAdmin` — the single authorization gate every Super Admin
 *     API goes through. The check is server-side and independent of the UI:
 *     hiding a nav link is presentation, never the security boundary, so an
 *     ADMIN or EXECUTIVE hitting these routes directly gets a 403.
 *
 *  2. The RECORD REGISTRY — a declarative description of the entities the
 *     Super Admin may inspect and correct. Everything the records API can
 *     read, search, filter or write is listed here, which is what keeps the
 *     surface safe: there is no free-form SQL and no "update any column"
 *     path, only these named fields on these named entities. Correctable
 *     fields are deliberately a SUBSET of what the audit layer can restore
 *     (RESTORABLE_FIELDS in admin-operations.ts), so every correction made
 *     here can actually be undone rather than merely claiming to be.
 */
import { NextResponse, type NextRequest } from "next/server";
import { $Enums } from "@prisma/client";
import { getAuthUser } from "@/lib/auth/middleware";
import { isSuperAdminRole } from "@/lib/auth/roles";

export interface SuperAdminGate {
  /** Set when the caller is NOT a super admin — return it as-is. */
  response?: NextResponse;
  /** Set when the caller IS a super admin. */
  user?: { userId: string; name: string; role: string };
}

/**
 * Authorize a Super Admin request. Returns either the caller or the response
 * to send back. Unauthenticated callers get 401, authenticated non-super
 * admins get 403 — an ADMIN must never be able to reach these endpoints.
 */
export async function requireSuperAdmin(request: NextRequest): Promise<SuperAdminGate> {
  const user = await getAuthUser(request);
  if (!user) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!isSuperAdminRole(user.role)) {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user: { userId: user.userId, name: user.name, role: user.role } };
}

// ─── Record registry ─────────────────────────────────────────────────────────

export type RecordEntity =
  | "users" | "clients" | "visits" | "tasks" | "subtasks"
  | "attendance" | "leaves" | "carry-forward" | "assignments" | "activity";

export type FieldKind = "text" | "boolean" | "date" | "datetime" | "select";

export interface CorrectableField {
  name: string;
  label: string;
  kind: FieldKind;
  options?: string[];
  /** Shown in the UI to explain what correcting this actually does. */
  help?: string;
  /** Blanking this field would leave an unusable record — reject it. */
  required?: boolean;
}

export interface EntitySpec {
  entity: RecordEntity;
  label: string;
  /** Prisma model the corrections are written to (audit entityType). */
  entityType: "User" | "Client" | "Visit" | "Task" | "Subtask" | "Attendance" | "LeaveRequest" | null;
  /** Status values offered as a filter, when the entity has a status. */
  statuses?: string[];
  /** Fields a Super Admin may correct. Empty ⇒ read-only view. */
  correctable: CorrectableField[];
  /** Why this entity is read-only, when it is. */
  readOnlyReason?: string;
}

export const RECORD_ENTITIES: EntitySpec[] = [
  {
    entity: "users",
    label: "Users",
    entityType: "User",
    statuses: ["ACTIVE", "INACTIVE"],
    correctable: [
      { name: "name", label: "Name", kind: "text", required: true },
      { name: "email", label: "Email", kind: "text", required: true },
      { name: "phone", label: "Mobile", kind: "text" },
      {
        name: "isActive", label: "Active", kind: "boolean",
        help: "Deactivating blocks sign-in. Existing visits, tasks and history are kept.",
      },
    ],
  },
  {
    entity: "clients",
    label: "Clients",
    entityType: "Client",
    statuses: ["ACTIVE", "ARCHIVED"],
    correctable: [
      { name: "name", label: "Name", kind: "text", required: true },
      { name: "contactPerson", label: "Contact person", kind: "text", required: true },
      { name: "address", label: "Address", kind: "text", required: true },
      { name: "phone", label: "Phone", kind: "text" },
      { name: "email", label: "Email", kind: "text" },
      { name: "isArchived", label: "Archived", kind: "boolean" },
    ],
  },
  {
    entity: "visits",
    label: "Visits",
    entityType: "Visit",
    statuses: ["PENDING", "OPEN", "CLOSED", "CANCELLED"],
    correctable: [
      { name: "scheduledDate", label: "Scheduled date", kind: "date" },
      { name: "endDate", label: "End date", kind: "date" },
      {
        name: "status", label: "Status", kind: "select",
        options: ["PENDING", "OPEN", "CLOSED", "CANCELLED"],
        help: "Correct a genuinely wrong status only. Task progress is not recalculated or reset.",
      },
      { name: "notes", label: "Notes", kind: "text" },
    ],
  },
  {
    entity: "tasks",
    label: "Tasks",
    entityType: "Task",
    statuses: ["PENDING", "IN_PROGRESS", "COMPLETED", "PARTIALLY_COMPLETED"],
    correctable: [
      { name: "title", label: "Title", kind: "text", required: true },
      {
        name: "status", label: "Status", kind: "select",
        options: ["PENDING", "IN_PROGRESS", "COMPLETED", "PARTIALLY_COMPLETED"],
        help: "Subtask completion is left exactly as the executive recorded it.",
      },
    ],
  },
  {
    entity: "subtasks",
    label: "Subtasks",
    entityType: "Subtask",
    correctable: [
      { name: "title", label: "Title", kind: "text", required: true },
      {
        name: "isCompleted", label: "Completed", kind: "boolean",
        help: "Corrects a wrongly recorded completion. The original completion timestamp is preserved.",
      },
      { name: "incompletionReason", label: "Incompletion reason", kind: "text" },
    ],
  },
  {
    entity: "carry-forward",
    label: "Carry Forward",
    entityType: "Subtask",
    statuses: ["REQUESTED", "APPROVED", "REJECTED", "CARRIED"],
    correctable: [
      {
        name: "isCompleted", label: "Completed", kind: "boolean",
        help: "Marks the carried item resolved or unresolved.",
      },
    ],
  },
  {
    // An executive's punch record. Correctable because a mistyped or missed
    // punch is exactly the kind of mistake §2 asks the Super Admin to fix —
    // but never silently: every change is audited with before/after and can be
    // undone. `date` is deliberately NOT correctable, because it is half of
    // the (executiveId, date) unique key that identifies the record.
    entity: "attendance",
    label: "Attendance",
    entityType: "Attendance",
    correctable: [
      {
        name: "punchIn", label: "Punch in", kind: "datetime", required: true,
        help: "Worked duration is recalculated from punch in/out after the correction.",
      },
      { name: "punchOut", label: "Punch out", kind: "datetime" },
      { name: "isLate", label: "Marked late", kind: "boolean" },
      { name: "notes", label: "Punch-out note", kind: "text" },
    ],
  },
  {
    // Leave decisions stay reviewable here. The existing Leave Approvals
    // workflow remains the normal path and is unchanged; this is the
    // correction path for a decision recorded wrongly.
    entity: "leaves",
    label: "Leave",
    entityType: "LeaveRequest",
    statuses: ["PENDING", "APPROVED", "REJECTED"],
    correctable: [
      {
        name: "status", label: "Status", kind: "select",
        options: ["PENDING", "APPROVED", "REJECTED"],
        help: "Correcting a decision recorded in error. The original reviewer and review time are preserved.",
      },
      { name: "adminComment", label: "Admin comment", kind: "text" },
      { name: "reason", label: "Reason given", kind: "text", required: true },
    ],
  },
  {
    entity: "assignments",
    label: "Visit Assignments",
    entityType: null,
    readOnlyReason:
      "Assignments are corrected on the visit itself — open the visit to change Solo/Team, the lead or the members, so the existing rules, leave-conflict checks and reassignment history all still apply.",
    correctable: [],
  },
  {
    entity: "activity",
    label: "Activity Log",
    entityType: null,
    readOnlyReason: "The activity log is an immutable record of what happened.",
    correctable: [],
  },
];

export function getEntitySpec(entity: string): EntitySpec | null {
  return RECORD_ENTITIES.find((e) => e.entity === entity) ?? null;
}

/**
 * Parse a date or date-time the way the rest of the application stores time.
 *
 * This app keeps timestamps as the intended WALL-CLOCK value in UTC — a visit
 * on 24 Aug is stored as 2026-08-24T00:00:00Z, and a punch at 09:30 is stored
 * as 09:30Z. But JavaScript splits on the format: `new Date("2026-08-24")`
 * (date-only) is parsed as UTC, while `new Date("2026-08-24T09:30")`
 * (date-time, no zone) is parsed in the SERVER'S local zone. An
 * `<input type="datetime-local">` submits exactly that zone-less form, so
 * saving a punch time unchanged would silently move it by the server's UTC
 * offset — 5½ hours here.
 *
 * Appending the explicit UTC designator makes both forms round-trip: what the
 * inspector displays is what gets stored.
 */
export function parseWallClock(value: string): Date {
  const v = value.trim();
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(v);
  const isDateTime = v.includes("T");
  return new Date(isDateTime && !hasZone ? `${v}Z` : v);
}

/**
 * Validate a correction payload against the registry.
 * Returns the write-ready data, or a human-readable error. Anything not
 * declared correctable for the entity is rejected outright rather than
 * silently dropped, so a caller can never quietly write an unlisted column.
 */
export function validateCorrection(
  spec: EntitySpec,
  patch: Record<string, unknown>
): { error?: string; data?: Record<string, unknown> } {
  if (!spec.entityType || spec.correctable.length === 0) {
    return { error: spec.readOnlyReason ?? `${spec.label} cannot be corrected here.` };
  }

  const data: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(patch)) {
    const field = spec.correctable.find((f) => f.name === key);
    if (!field) return { error: `"${key}" is not a correctable field on ${spec.label}.` };

    if (raw === null || raw === "") {
      // A field the record cannot exist without must never be blanked. This is
      // driven by the field's own `required` flag — an earlier version keyed it
      // off the entity name and let a client's NOT NULL columns through, which
      // surfaced as a database error instead of a clear message.
      if (field.required) {
        return { error: `${field.label} cannot be empty.` };
      }
      data[key] = field.kind === "boolean" ? false : null;
      continue;
    }

    switch (field.kind) {
      case "boolean":
        if (typeof raw !== "boolean") return { error: `${field.label} must be true or false.` };
        data[key] = raw;
        break;
      case "date":
      case "datetime": {
        const d = parseWallClock(String(raw));
        if (isNaN(d.getTime())) return { error: `${field.label} is not a valid ${field.kind}.` };
        data[key] = d;
        break;
      }
      case "select":
        if (!field.options?.includes(String(raw))) {
          return { error: `${field.label} must be one of: ${field.options?.join(", ")}.` };
        }
        data[key] = String(raw);
        break;
      default: {
        const s = String(raw).trim();
        if (key === "name" && s.length < 2) return { error: "Name must be at least 2 characters." };
        if (key === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
          return { error: "Enter a valid email address." };
        }
        data[key] = s;
      }
    }
  }

  if (Object.keys(data).length === 0) return { error: "Nothing to change." };
  return { data };
}

/**
 * ActivityLog.action is a Postgres ENUM, so it cannot be searched with a
 * `contains` filter the way a text column can — Prisma rejects it. Instead,
 * resolve the free-text query to the set of enum values it matches and filter
 * with `in`. Returns null when nothing matches, so the caller can drop the
 * clause rather than send an empty `in` that matches everything.
 */
export function activityActionsMatching(q: string): string[] | null {
  const needle = q.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!needle) return null;
  const matches = Object.values($Enums.ActivityAction).filter((a) => a.includes(needle));
  return matches.length > 0 ? matches : null;
}

/** Clamp paging input — no request may ask for an unbounded result set (§16). */
export function paging(searchParams: URLSearchParams): { page: number; pageSize: number; skip: number } {
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(Math.max(Number(searchParams.get("pageSize")) || 25, 5), 100);
  return { page, pageSize, skip: (page - 1) * pageSize };
}

/** Parse an inclusive from/to day range, when supplied. */
export function dateRange(searchParams: URLSearchParams): { gte?: Date; lte?: Date } | null {
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const range: { gte?: Date; lte?: Date } = {};
  if (from) {
    const d = new Date(from);
    if (!isNaN(d.getTime())) range.gte = d;
  }
  if (to) {
    const d = new Date(to);
    if (!isNaN(d.getTime())) range.lte = new Date(d.getTime() + 24 * 60 * 60 * 1000 - 1);
  }
  return Object.keys(range).length > 0 ? range : null;
}
