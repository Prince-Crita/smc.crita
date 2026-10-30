import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { prisma } from "@/lib/db/prisma";
import { canViewVisit, canWorkVisit, canCloseVisit } from "@/lib/utils/visit-access";
import {
  getPhotoStorage,
  inspectUploadedPhoto,
  deletePhotoObjects,
  parseStartPhotos,
  VISIT_PHOTO_MAX_BYTES,
  PHOTO_STORAGE_UNAVAILABLE_MESSAGE,
} from "@/lib/storage/visit-photos";
import { sniffImageType, readJpegGps } from "@/lib/storage/image-inspect";

// GET /api/visits/[visitId] - Get single visit with all tasks and subtasks
export async function GET(request: NextRequest, { params }: { params: Promise<{ visitId: string }> }) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { visitId } = await params;

  try {
    const visit = await prisma.visit.findUnique({
      where: { id: visitId },
      include: {
        // Select only the client fields consumed by the visit detail UI.
        // Previously `include: { client: true }` over-fetched reportEmails,
        // assignedExecId, isArchived, updatedAt, etc. — all unused here.
        client: {
          select: {
            name: true,
            code: true,
            contactPerson: true,
            address: true,
            phone: true,
          },
        },
        executive: { select: { id: true, name: true, email: true } },
        assignments: {
          select: { executiveId: true, role: true, executive: { select: { id: true, name: true } } },
        },
        tasks: {
          include: {
            subtasks: {
              orderBy: [{ isCarriedForward: "asc" }, { createdAt: "asc" }],
            },
          },
          orderBy: { orderIndex: "asc" },
        },
        activityLogs: {
          include: {
            user: { select: { name: true, role: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        },
        // Only the number of geotagged photos; the photos themselves (and
        // their signed URLs) are loaded by the photo section on demand.
        _count: { select: { photos: true } },
      },
    });


    if (!visit) {
      return NextResponse.json({ error: "Visit not found" }, { status: 404 });
    }

    // Executives see their own visits AND the team visits they are on.
    if (user.role === "EXECUTIVE" && !canViewVisit(visit, user.userId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Calculate progress
    const totalSubtasks = visit.tasks.reduce((sum, t) => sum + t.subtasks.length, 0);
    const completedSubtasks = visit.tasks.reduce(
      (sum, t) => sum + t.subtasks.filter((s) => s.isCompleted).length,
      0
    );
    const progress = totalSubtasks === 0 ? 0 : Math.round((completedSubtasks / totalSubtasks) * 100);

    const { _count, ...visitFields } = visit;

    // `canClose` drives whether the executive's visit page offers the Close
    // button. The close endpoint enforces the same rule server-side, so hiding
    // the button is presentation only, never the security boundary.
    return NextResponse.json({
      visit: {
        ...visitFields,
        progress,
        totalSubtasks,
        completedSubtasks,
        photoCount: _count.photos,
        isTeamVisit: visit.visitType === "TEAM",
        canClose: canCloseVisit(visit, user.userId),
        teamLead: { id: visit.executive.id, name: visit.executive.name },
        teamMembers: visit.assignments
          .filter((a) => a.role !== "LEAD")
          .map((a) => ({ id: a.executiveId, name: a.executive.name })),
      },
    });
  } catch (error) {
    console.error("Get visit error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/visits/[visitId] - Open (start) a visit
//
// Starting a visit REQUIRES at least one geotagged photo. The photos are
// uploaded to S3 first (POST /api/visits/[visitId]/photos hands out the signed
// upload URLs); this request then names them:
//   { photos: [{ key, name, contentType, size }] }
//
// Nothing is written until every photo has been verified HERE, on the server:
// the key must be one issued for this visit, the object must exist in S3,
// be within the size limit and really be an image by its signature bytes.
// The visit is then opened and the photo records created in ONE transaction,
// so a visit can never be OPEN without its photos, and photos are never
// recorded against a visit that did not start. Any failure leaves the visit
// PENDING, exactly as it was.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ visitId: string }> }) {
  const user = await getAuthUser(request);
  if (!user || user.role !== "EXECUTIVE") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { visitId } = await params;

  try {
    const visit = await prisma.visit.findUnique({
      where: { id: visitId },
      include: { assignments: { select: { executiveId: true, role: true } } },
    });
    if (!visit) return NextResponse.json({ error: "Visit not found" }, { status: 404 });

    // Any executive on the visit may open it — a team member arriving first
    // must be able to start work without waiting for the lead. Closing stays
    // lead-only.
    if (!canWorkVisit(visit, user.userId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (visit.status !== "PENDING") {
      return NextResponse.json({ error: "Visit is already open or closed" }, { status: 400 });
    }

    // ── Mandatory geotagged photo(s) ───────────────────────────────────────
    const body = await request.json().catch(() => null) as { photos?: unknown } | null;
    const parsed = parseStartPhotos(visitId, body?.photos);
    if (parsed.error) {
      return NextResponse.json({ error: parsed.error, code: parsed.code }, { status: 400 });
    }

    const storage = getPhotoStorage();
    if (!storage) {
      return NextResponse.json({ error: PHOTO_STORAGE_UNAVAILABLE_MESSAGE, code: "STORAGE_UNAVAILABLE" }, { status: 503 });
    }

    const verified: {
      key: string;
      name: string | null;
      contentType: string;
      sizeBytes: number;
      gps: { latitude: number; longitude: number } | null;
    }[] = [];
    for (const photo of parsed.photos) {
      let info;
      try {
        info = await inspectUploadedPhoto(storage, photo.key);
      } catch (err) {
        console.error("[open-visit] S3 verification failed:", err);
        return NextResponse.json(
          { error: "Could not verify the uploaded photos right now. Please check your connection and try again.", code: "STORAGE_ERROR" },
          { status: 502 }
        );
      }
      const label = photo.name ? `"${photo.name}"` : "A photo";
      if (!info) {
        return NextResponse.json(
          { error: `${label} did not finish uploading. Please upload it again.`, code: "PHOTO_NOT_UPLOADED" },
          { status: 400 }
        );
      }
      const actualType = sniffImageType(info.head);
      if (actualType !== photo.contentType || info.sizeBytes <= 0 || info.sizeBytes > VISIT_PHOTO_MAX_BYTES) {
        // Never referenced by any visit — remove it so it does not linger.
        await deletePhotoObjects(storage, [photo.key]);
        return NextResponse.json(
          { error: `${label} is not a valid JPG, PNG or WebP image (or is larger than the limit). Please remove it and choose another photo.`, code: "INVALID_PHOTO" },
          { status: 400 }
        );
      }
      verified.push({
        key: photo.key,
        name: photo.name,
        contentType: actualType,
        sizeBytes: info.sizeBytes,
        gps: actualType === "image/jpeg" ? readJpegGps(info.head) : null,
      });
    }

    // ── Open the visit and record its photos, atomically ───────────────────
    // The status condition makes this safe against two team members pressing
    // Open Visit at the same moment: only one of them starts the visit.
    const openedAt = new Date();
    const opened = await prisma.$transaction(async (tx) => {
      const started = await tx.visit.updateMany({
        where: { id: visitId, status: "PENDING" },
        data: { status: "OPEN", openedAt },
      });
      if (started.count === 0) return false;
      await tx.visitPhoto.createMany({
        data: verified.map((p) => ({
          visitId,
          uploadedById: user.userId,
          s3Key: p.key,
          originalName: p.name,
          contentType: p.contentType,
          sizeBytes: p.sizeBytes,
          gpsLatitude: p.gps?.latitude ?? null,
          gpsLongitude: p.gps?.longitude ?? null,
        })),
        skipDuplicates: true,
      });
      return true;
    });

    if (!opened) {
      // Someone else started the visit in the meantime; these uploads were
      // never recorded against it.
      await deletePhotoObjects(storage, verified.map((p) => p.key));
      return NextResponse.json({ error: "Visit is already open or closed" }, { status: 400 });
    }

    await prisma.activityLog.create({
      data: {
        visitId,
        userId: user.userId,
        action: "VISIT_OPENED",
        metadata: { visitNumber: visit.visitNumber, executiveName: user.name, photoCount: verified.length },
      },
    });

    const updatedVisit = await prisma.visit.findUnique({ where: { id: visitId } });

    return NextResponse.json({ visit: updatedVisit, photoCount: verified.length });
  } catch (error) {
    console.error("Open visit error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
