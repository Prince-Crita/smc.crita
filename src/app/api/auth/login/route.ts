import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { signJwt, COOKIE_NAME, SESSION_MAX_AGE_SECONDS, REMEMBER_MAX_AGE_SECONDS } from "@/lib/auth/jwt";
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
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });

    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge, // matches the JWT expiry exactly (8h, or 30d with Remember Me)
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
