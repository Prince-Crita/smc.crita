/**
 * POST /api/auth/continue  { userId }
 *
 * Re-authenticates a remembered account on THIS DEVICE with one tap, without
 * the user retyping credentials — the Instagram/Facebook "tap your account"
 * flow.
 *
 * How it stays secure:
 *   • Authorisation comes ONLY from the httpOnly `smc_remember` cookie, which
 *     JavaScript cannot read and which a cross-site POST cannot send
 *     (SameSite=Lax). The `userId` in the body is just a selector — it is
 *     worthless unless that exact ID is already inside the signed cookie.
 *   • The user is re-read from the database on every call, so a deactivated
 *     or deleted account can never continue, no matter how old the cookie is.
 *   • A fresh, normal session JWT is minted here. The remember cookie is not
 *     a session and is never accepted as one (verifyJwt rejects it by type).
 *
 * Trade-off, stated plainly: because the remember cookie survives logout by
 * design, anyone with physical access to an unlocked remembered device can tap
 * Continue and reach that account. That is inherent to the requested feature —
 * it is exactly what Instagram/Facebook do. Users who do not want it simply
 * leave "Remember Me" unticked, or use Remove on the account card.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  signJwt,
  COOKIE_NAME,
  REMEMBER_COOKIE_NAME,
  REMEMBER_MAX_AGE_SECONDS,
  readRememberedUserIds,
} from "@/lib/auth/jwt";
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

    // Not remembered on this device (or the cookie expired / was cleared).
    // The client falls back to the normal login form with the identifier
    // prefilled — the account is still offered, it just needs a password.
    if (!rememberedIds.includes(userId)) {
      return NextResponse.json(
        { error: "This account is no longer remembered on this device. Please sign in.", code: "NOT_REMEMBERED" },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user || !user.isActive) {
      // Account gone or deactivated — drop it from the device list so the card
      // stops being offered, and make the client clear its local copy too.
      const response = NextResponse.json(
        {
          error: user ? "This account has been deactivated." : "This account no longer exists.",
          code: "ACCOUNT_UNAVAILABLE",
        },
        { status: 401 }
      );
      await writeRememberCookie(response, rememberedIds.filter((id) => id !== userId));
      return response;
    }

    // Remembered accounts always get the long session — the user already told
    // us to keep them signed in on this device.
    const maxAge = REMEMBER_MAX_AGE_SECONDS;
    const token = await signJwt(
      { userId: user.id, email: user.email, name: user.name, role: user.role },
      maxAge
    );

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: "USER_LOGIN",
        metadata: {
          role: user.role,
          name: user.name,
          via: "REMEMBERED_ACCOUNT",
          ip: request.headers.get("x-forwarded-for") || "unknown",
        },
      },
    });

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });

    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge,
      path: "/",
    });

    // Re-sign so an actively used device keeps a rolling 30-day window.
    await writeRememberCookie(response, rememberedIds);

    return response;
  } catch (error) {
    console.error("Continue (remembered account) error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
