/**
 * POST /api/auth/forget  { userId }
 *
 * Removes ONE account from this device's remembered list. Every other
 * remembered account is left untouched, and nothing about the user's actual
 * account is changed — this only edits the device-local `smc_remember` cookie.
 *
 * Public (no session required) because the user is, by definition, signed out
 * when managing cards on the login screen. It is not sensitive: the caller can
 * only ever shrink their own device's list, never read it or add to it.
 */

import { NextRequest, NextResponse } from "next/server";
import { REMEMBER_COOKIE_NAME, readRememberedUserIds } from "@/lib/auth/jwt";
import { writeRememberCookie } from "@/lib/auth/remember-cookie";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { userId?: unknown };
    const userId = typeof body.userId === "string" ? body.userId : "";
    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const rememberedIds = await readRememberedUserIds(
      request.cookies.get(REMEMBER_COOKIE_NAME)?.value
    );

    const response = NextResponse.json({ success: true });
    await writeRememberCookie(response, rememberedIds.filter((id) => id !== userId));
    return response;
  } catch (error) {
    console.error("Forget remembered account error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
