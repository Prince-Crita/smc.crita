import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/middleware";
import bcrypt from "bcryptjs";

// ─── GET /api/super-admin/admins ──────────────────────────────────────────────
// Lists ADMIN accounts only (Super Admin accounts are never listed/edited here).

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "SUPER_ADMIN")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN" },
      select: { id: true, name: true, email: true, phone: true, isActive: true, createdAt: true },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ admins });
  } catch (error) {
    console.error("Get admins error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST /api/super-admin/admins ─────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "SUPER_ADMIN")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await request.json();
    const { name, email, phone, password } = body;

    if (!name || name.trim().length < 2)
      return NextResponse.json({ error: "Name must be at least 2 characters" }, { status: 400 });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    if (!password || password.length < 8)
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists)
      return NextResponse.json({ error: "Email already registered" }, { status: 409 });

    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await prisma.user.create({
      data: {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        phone: phone || null,
        passwordHash,
        role: "ADMIN",
        isActive: true,
      },
    });

    await prisma.activityLog.create({
      data: {
        userId: user.userId,
        action: "ADMIN_ADDED",
        metadata: { adminName: admin.name, adminEmail: admin.email, addedBy: user.name },
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash: _, ...safeAdmin } = admin;
    return NextResponse.json({ admin: safeAdmin }, { status: 201 });
  } catch (error) {
    console.error("Create admin error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
