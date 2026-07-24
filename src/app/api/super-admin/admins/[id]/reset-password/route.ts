import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/middleware";
import bcrypt from "bcryptjs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  try {
    const body = await request.json();
    const { newPassword } = body;

    if (!newPassword || newPassword.length < 8) {
      return NextResponse.json({ error: "New password must be at least 8 characters" }, { status: 400 });
    }

    const admin = await prisma.user.findUnique({ where: { id, role: "ADMIN" } });
    if (!admin) return NextResponse.json({ error: "Admin not found" }, { status: 404 });

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id }, data: { passwordHash } });

    await prisma.activityLog.create({
      data: {
        userId: user.userId,
        action: "ADMIN_PASSWORD_RESET",
        metadata: { adminId: id, adminName: admin.name, resetBy: user.name },
      },
    });

    return NextResponse.json({ success: true, message: "Password reset successfully" });
  } catch (error) {
    console.error("Reset password error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
