import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { isAdminRole } from "@/lib/auth/roles";
import { prisma } from "@/lib/db/prisma";
import { canViewVisit } from "@/lib/utils/visit-access";
import { getPhotoStorage, presignPhotoView, PHOTO_STORAGE_UNAVAILABLE_MESSAGE } from "@/lib/storage/visit-photos";

// ─── /api/visits/[visitId]/photos/[photoId] ───────────────────────────────────
// Opens ONE visit photo. The gallery uses this address directly as the image
// source, so the browser only asks for an image when it actually shows it
// (thumbnails load lazily when the section is expanded, the large preview
// when a photo is tapped).
//
// Every request re-checks who is asking (the same rule as the visit page),
// then signs a fresh S3 link for this single image, valid for
// VIEW_URL_TTL_SECONDS, and redirects to it. No S3 link is ever stored,
// listed or handed out in advance, and a copied link stops working within
// minutes.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ visitId: string; photoId: string }> }
) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { visitId, photoId } = await params;

  try {
    const photo = await prisma.visitPhoto.findFirst({
      where: { id: photoId, visitId },
      select: {
        s3Key: true,
        visit: { select: { executiveId: true, assignments: { select: { executiveId: true, role: true } } } },
      },
    });
    if (!photo) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

    const allowed = user.role === "EXECUTIVE" ? canViewVisit(photo.visit, user.userId) : isAdminRole(user.role);
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const storage = getPhotoStorage();
    if (!storage) return NextResponse.json({ error: PHOTO_STORAGE_UNAVAILABLE_MESSAGE }, { status: 503 });

    const url = await presignPhotoView(storage, photo.s3Key);
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Open visit photo error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
