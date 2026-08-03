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
    // Explicit path/flags so the long-lived "Remember Me" cookie is reliably
    // cleared — logout must always win over Remember Me.
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
    // Explicit path/flags so the long-lived "Remember Me" cookie is reliably
    // cleared — logout must always win over Remember Me.
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
