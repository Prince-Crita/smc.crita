import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { isAdminRole } from "@/lib/auth/roles";
import { prisma } from "@/lib/db/prisma";
import { canViewVisit, canWorkVisit } from "@/lib/utils/visit-access";
import {
  getPhotoStorage,
  newVisitPhotoKey,
  presignPhotoUpload,
  VISIT_PHOTO_TYPES,
  VISIT_PHOTO_MAX_BYTES,
  VISIT_PHOTO_MAX_COUNT,
  UPLOAD_URL_TTL_SECONDS,
  PHOTO_STORAGE_UNAVAILABLE_MESSAGE,
} from "@/lib/storage/visit-photos";

// ─── /api/visits/[visitId]/photos ─────────────────────────────────────────────
// Geotagged visit photos. The images live in a PRIVATE S3 bucket; this route
// only hands out short-lived signed URLs after checking who is asking.
//
//   GET  - the visit's photo list: who uploaded each photo, when, its name,
//          size and any EXIF GPS. It carries NO image links — each image is
//          opened through GET /api/visits/[visitId]/photos/[photoId], which
//          signs a short-lived S3 link only at the moment it is shown.
//          Admin / Super Admin: any visit. Executive: visits they own or are
//          on the team of (the same rule as the visit page itself).
//
//   POST - signed upload URLs for starting the visit.
//          Body: { files: [{ name, type, size }] }
//          Only an executive who may work the visit, and only while it is
//          still PENDING. Uploading does NOT start the visit: Open Visit
//          (PATCH /api/visits/[visitId]) verifies the uploaded objects and
//          starts it in the same step.

export async function GET(request: NextRequest, { params }: { params: Promise<{ visitId: string }> }) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { visitId } = await params;

  try {
    const visit = await prisma.visit.findUnique({
      where: { id: visitId },
      select: { id: true, executiveId: true, assignments: { select: { executiveId: true, role: true } } },
    });
    if (!visit) return NextResponse.json({ error: "Visit not found" }, { status: 404 });

    const allowed = user.role === "EXECUTIVE" ? canViewVisit(visit, user.userId) : isAdminRole(user.role);
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const photos = await prisma.visitPhoto.findMany({
      where: { visitId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        originalName: true,
        contentType: true,
        sizeBytes: true,
        gpsLatitude: true,
        gpsLongitude: true,
        createdAt: true,
        uploadedBy: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ photos, storageConfigured: !!getPhotoStorage() });
  } catch (error) {
    console.error("Get visit photos error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ visitId: string }> }) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "EXECUTIVE") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { visitId } = await params;

  try {
    const visit = await prisma.visit.findUnique({
      where: { id: visitId },
      select: { id: true, status: true, executiveId: true, assignments: { select: { executiveId: true, role: true } } },
    });
    if (!visit) return NextResponse.json({ error: "Visit not found" }, { status: 404 });
    if (!canWorkVisit(visit, user.userId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (visit.status !== "PENDING") {
      return NextResponse.json({ error: "Visit is already open or closed" }, { status: 400 });
    }

    const body = await request.json().catch(() => null) as { files?: unknown } | null;
    const files = Array.isArray(body?.files) ? body!.files as { name?: unknown; type?: unknown; size?: unknown }[] : [];
    if (files.length === 0) {
      return NextResponse.json({ error: "Select at least one photo to upload." }, { status: 400 });
    }
    if (files.length > VISIT_PHOTO_MAX_COUNT) {
      return NextResponse.json({ error: `You can upload up to ${VISIT_PHOTO_MAX_COUNT} photos per visit.` }, { status: 400 });
    }
    for (const f of files) {
      const type = typeof f?.type === "string" ? f.type : "";
      const size = typeof f?.size === "number" ? f.size : NaN;
      if (!VISIT_PHOTO_TYPES[type]) {
        return NextResponse.json({ error: "Only JPG, PNG or WebP photos can be uploaded." }, { status: 400 });
      }
      if (!Number.isInteger(size) || size <= 0) {
        return NextResponse.json({ error: "One of the selected photos is empty." }, { status: 400 });
      }
      if (size > VISIT_PHOTO_MAX_BYTES) {
        return NextResponse.json(
          { error: `Each photo must be ${Math.round(VISIT_PHOTO_MAX_BYTES / (1024 * 1024))} MB or smaller.` },
          { status: 400 }
        );
      }
    }

    const storage = getPhotoStorage();
    if (!storage) return NextResponse.json({ error: PHOTO_STORAGE_UNAVAILABLE_MESSAGE }, { status: 503 });

    const uploads = await Promise.all(
      files.map(async (f) => {
        const contentType = f.type as string;
        const key = newVisitPhotoKey(visitId, contentType);
        return { key, contentType, url: await presignPhotoUpload(storage, key, contentType, f.size as number) };
      })
    );

    return NextResponse.json({ uploads, expiresInSeconds: UPLOAD_URL_TTL_SECONDS });
  } catch (error) {
    console.error("Prepare visit photo upload error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
