import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/utils/super-admin";
import { runHealthChecks } from "@/lib/utils/system-health";

// ─── GET /api/super-admin/health ─────────────────────────────────────────────
// Data-integrity diagnostics (§8). READ ONLY: this endpoint detects and
// explains, it never repairs. Corrections are made deliberately through
// PATCH /api/super-admin/records, where they are audited and reversible.
export async function GET(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if (gate.response) return gate.response;

  try {
    return NextResponse.json(await runHealthChecks());
  } catch (error) {
    console.error("Super admin health error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
