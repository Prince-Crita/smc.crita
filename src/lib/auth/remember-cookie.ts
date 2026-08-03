/**
 * Server-side helpers for the device "Remember Account" cookie.
 *
 * One place that knows how the cookie is written, so login / continue / forget
 * can never drift apart on flags or lifetime. The cookie carries ONLY user
 * IDs (see signRememberToken) — never a password, session token or role.
 *
 * Flags are deliberately identical to the session cookie:
 *   httpOnly  → unreadable from JavaScript, so XSS cannot exfiltrate it
 *   secure    → HTTPS only in production (the Capacitor APK loads the app
 *               over HTTPS, so this holds on Android too)
 *   sameSite  → Lax: not sent on cross-site POSTs, so /api/auth/continue
 *               cannot be driven by a CSRF form on another origin
 */

import type { NextResponse } from "next/server";
import {
  REMEMBER_COOKIE_NAME,
  REMEMBER_DEVICE_MAX_AGE_SECONDS,
  signRememberToken,
} from "./jwt";

/**
 * Persist the given remembered user IDs on this device.
 * An empty list clears the cookie outright.
 */
export async function writeRememberCookie(
  response: NextResponse,
  userIds: string[]
): Promise<void> {
  const token = await signRememberToken(userIds);

  if (!token) {
    response.cookies.set(REMEMBER_COOKIE_NAME, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });
    return;
  }

  response.cookies.set(REMEMBER_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    // Re-signed on every login/continue, so an actively used device keeps a
    // rolling 30-day window rather than expiring on a fixed date.
    maxAge: REMEMBER_DEVICE_MAX_AGE_SECONDS,
    path: "/",
  });
}
