import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthUser } from "@/lib/auth/middleware";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  try {
    const body = await request.json();
    const { name, email, phone, isActive } = body;

    const existing = await prisma.user.findUnique({ where: { id, role: "ADMIN" } });
    if (!existing) return NextResponse.json({ error: "Admin not found" }, { status: 404 });

    if (email && email !== existing.email) {
      const emailTaken = await prisma.user.findUnique({ where: { email } });
      if (emailTaken) return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(name && { name: name.trim() }),
        ...(email && { email: email.toLowerCase().trim() }),
        ...(phone !== undefined && { phone: phone || null }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    const wasDeactivated = isActive === false && existing.isActive === true;
    await prisma.activityLog.create({
      data: {
        userId: user.userId,
        action: wasDeactivated ? "ADMIN_DEACTIVATED" : "ADMIN_UPDATED",
        metadata: { adminId: id, adminName: updated.name, updatedBy: user.name },
      },
    });

    const { passwordHash: _, ...safeAdmin } = updated;
    return NextResponse.json({ admin: safeAdmin });
  } catch (error) {
    console.error("Update admin error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
