import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import {
  signJwt,
  COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  REMEMBER_MAX_AGE_SECONDS,
  REMEMBER_COOKIE_NAME,
  readRememberedUserIds,
} from "@/lib/auth/jwt";
import { writeRememberCookie } from "@/lib/auth/remember-cookie";
import { loginSchema } from "@/lib/validations/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = loginSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { identifier, password, rememberMe } = result.data;
    const trimmedIdentifier = identifier.trim();
    const isEmail = trimmedIdentifier.includes("@");

    const user = isEmail
      ? await prisma.user.findUnique({ where: { email: trimmedIdentifier } })
      : await prisma.user.findUnique({ where: { phone: trimmedIdentifier.replace(/\s+/g, "") } });
    if (!user) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    // "Remember Me" only extends the session lifetime. Everything else about
    // the session is unchanged: same signed JWT, same httpOnly cookie, same
    // Secure/SameSite flags, same server-side verification on every request.
    // No token is ever exposed to JavaScript or stored in localStorage.
    const maxAge = rememberMe ? REMEMBER_MAX_AGE_SECONDS : SESSION_MAX_AGE_SECONDS;

    const token = await signJwt({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    }, maxAge);

    // Log login activity
    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: "USER_LOGIN",
        metadata: { role: user.role, name: user.name, rememberMe: !!rememberMe, ip: request.headers.get("x-forwarded-for") || "unknown" },
      },
    });

    const response = NextResponse.json({
      success: true,
      // Non-secret profile fields the login screen stores locally to render the
      // remembered-account card. Deliberately no token of any kind.
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
      remembered: !!rememberMe,
    });

    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge, // matches the JWT expiry exactly (8h, or 30d with Remember Me)
      path: "/",
    });

    // ── Remember this ACCOUNT on this DEVICE ────────────────────────────────
    // Additive: existing remembered accounts on the device are preserved, so
    // several people (admin + executives) can be offered on the same phone.
    // Only written when the box is ticked — an unticked login leaves the
    // device list exactly as it was, matching today's behaviour.
    if (rememberMe) {
      const existing = await readRememberedUserIds(
        request.cookies.get(REMEMBER_COOKIE_NAME)?.value
      );
      await writeRememberCookie(response, [...existing, user.id]);
    }

    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
