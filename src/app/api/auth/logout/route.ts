import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/middleware";
import { COOKIE_NAME } from "@/lib/auth/jwt";

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (user) {
      await prisma.activityLog.create({
        data: {
          userId: user.userId,
          action: "USER_LOGOUT",
          metadata: { name: user.name, role: user.role },
        },
      });
    }
    const response = NextResponse.json({ success: true });
    // Clears the SESSION cookie only, with explicit path/flags so even a
    // 30-day session is reliably ended.
    //
    // The device's `smc_remember` cookie is intentionally NOT touched here:
    // logging out ends the session, it does not un-remember the account. The
    // card stays on the login screen so the user can tap Continue — that is
    // the whole point of Remember Account. Use POST /api/auth/forget (the
    // Remove button on the card) to actually drop an account from a device.
    response.cookies.set(COOKIE_NAME, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });
    return response;
  } catch {
    const response = NextResponse.json({ success: true });
    // Clears the SESSION cookie only, with explicit path/flags so even a
    // 30-day session is reliably ended.
    //
    // The device's `smc_remember` cookie is intentionally NOT touched here:
    // logging out ends the session, it does not un-remember the account. The
    // card stays on the login screen so the user can tap Continue — that is
    // the whole point of Remember Account. Use POST /api/auth/forget (the
    // Remove button on the card) to actually drop an account from a device.
    response.cookies.set(COOKIE_NAME, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });
    return response;
  }
}
