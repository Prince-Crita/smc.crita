/**
 * Geotagged visit photos — S3 storage (SERVER ONLY).
 *
 * Import this only from route handlers and server components: it reads the
 * AWS credentials from the environment, and they must never reach a browser.
 *
 * WHY THE BROWSER UPLOADS STRAIGHT TO S3
 * Vercel rejects any request body over 4.5 MB, and a single phone photo is
 * often larger, so photos cannot pass through this app's own API. Instead the
 * server, after checking the executive may start the visit, signs a short-lived
 * PUT URL per photo. Each URL is bound to ONE server-chosen key under this
 * visit's folder and to the exact content type and byte size declared, so it
 * cannot be reused for another file, another key or another visit. The AWS
 * secret never leaves the server.
 *
 * Starting the visit (PATCH /api/visits/[visitId]) then re-checks every
 * uploaded object on the server — present, within the size limit, and really
 * an image by its signature bytes — before anything is written.
 *
 * Object keys:  smc-task-management/visits/{visitId}/{uuid}.{jpg|png|webp}
 * The original filename is never used in a key.
 *
 * Environment (all four required; see the release notes for where to set them):
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_S3_BUCKET
 * Optional, for local testing against an S3-compatible server only:
 *   AWS_S3_ENDPOINT
 */

import { randomUUID } from "crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ─── Limits ───────────────────────────────────────────────────────────────────

export const VISIT_PHOTO_MAX_BYTES = 15 * 1024 * 1024; // 15 MB per photo
export const VISIT_PHOTO_MAX_COUNT = 10;               // per visit start
export const UPLOAD_URL_TTL_SECONDS = 10 * 60;         // signed upload URL lifetime
export const VIEW_URL_TTL_SECONDS = 2 * 60;            // signed view URL lifetime (signed per image, when opened)

/** Accepted photo types and the key extension each is stored under. */
export const VISIT_PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const PHOTO_REQUIRED_MESSAGE =
  "Please upload at least one geotagged visit photo before starting the visit.";

export const PHOTO_STORAGE_UNAVAILABLE_MESSAGE =
  "Photo upload is not available right now (storage is not configured). Please contact the administrator.";

const KEY_ROOT = "smc-task-management/visits";

// ─── Client ───────────────────────────────────────────────────────────────────

export interface PhotoStorage {
  client: S3Client;
  bucket: string;
}

let storage: PhotoStorage | null | undefined;

/**
 * The configured S3 client, or null when any required variable is missing —
 * callers then refuse to start a visit instead of starting it without photos.
 *
 * Credentials are passed explicitly rather than left to the SDK's default
 * chain, so only the values configured for this app are ever used.
 */
export function getPhotoStorage(): PhotoStorage | null {
  if (storage !== undefined) return storage;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
  const region = process.env.AWS_REGION?.trim();
  const bucket = process.env.AWS_S3_BUCKET?.trim();
  if (!accessKeyId || !secretAccessKey || !region || !bucket) {
    storage = null;
    return storage;
  }
  const endpoint = process.env.AWS_S3_ENDPOINT?.trim();
  storage = {
    bucket,
    client: new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      // Recent SDK versions add a CRC32 checksum to presigned PUT URLs by
      // default, computed over an EMPTY body, which makes every real browser
      // upload fail. Checksums are only added where S3 requires them.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    }),
  };
  return storage;
}

// ─── Keys ─────────────────────────────────────────────────────────────────────

/** A fresh, unguessable key in this visit's folder. Never uses a filename. */
export function newVisitPhotoKey(visitId: string, contentType: string): string {
  return `${KEY_ROOT}/${visitId}/${randomUUID()}.${VISIT_PHOTO_TYPES[contentType]}`;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True only for a key this app would have issued for THIS visit. */
export function isVisitPhotoKey(visitId: string, key: string): boolean {
  return new RegExp(
    `^${escapeRegExp(KEY_ROOT)}/${escapeRegExp(visitId)}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(jpg|png|webp)$`
  ).test(key);
}

/** The content type a key's extension stands for. */
export function contentTypeForKey(key: string): string | null {
  const ext = key.slice(key.lastIndexOf(".") + 1);
  return Object.keys(VISIT_PHOTO_TYPES).find((t) => VISIT_PHOTO_TYPES[t] === ext) ?? null;
}

/** A safe display name: no path, no control characters, bounded length. */
export function cleanOriginalName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
  return cleaned || null;
}

// ─── Signed URLs ──────────────────────────────────────────────────────────────

/**
 * A PUT URL that only accepts this exact key, content type and byte size.
 * The browser must send `Content-Type: <contentType>`; the size is enforced
 * through the signed Content-Length.
 */
export function presignPhotoUpload(
  s: PhotoStorage,
  key: string,
  contentType: string,
  sizeBytes: number
): Promise<string> {
  return getSignedUrl(
    s.client,
    new PutObjectCommand({ Bucket: s.bucket, Key: key, ContentType: contentType, ContentLength: sizeBytes }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS, signableHeaders: new Set(["content-type", "content-length"]) }
  );
}

/**
 * A short-lived URL to view one photo, signed only when that image is opened
 * (GET /api/visits/[visitId]/photos/[photoId]). The bucket itself stays private.
 */
export function presignPhotoView(s: PhotoStorage, key: string): Promise<string> {
  return getSignedUrl(s.client, new GetObjectCommand({ Bucket: s.bucket, Key: key }), {
    expiresIn: VIEW_URL_TTL_SECONDS,
  });
}

// ─── Verification of an uploaded object ──────────────────────────────────────

export interface UploadedPhotoInfo {
  sizeBytes: number;
  contentType: string | undefined;
  /** The first bytes of the object (signature + EXIF live here). */
  head: Uint8Array;
}

const HEAD_BYTES = 128 * 1024;

/**
 * Size, stored content type and the first 128 KB of an uploaded object, or
 * null when no object exists under the key (the upload never completed).
 * Throws on any other S3 error, so callers fail safely instead of guessing.
 */
export async function inspectUploadedPhoto(s: PhotoStorage, key: string): Promise<UploadedPhotoInfo | null> {
  try {
    const head = await s.client.send(new HeadObjectCommand({ Bucket: s.bucket, Key: key }));
    const sizeBytes = Number(head.ContentLength ?? 0);
    const part = await s.client.send(
      new GetObjectCommand({ Bucket: s.bucket, Key: key, Range: `bytes=0-${HEAD_BYTES - 1}` })
    );
    const bytes = part.Body ? await part.Body.transformToByteArray() : new Uint8Array();
    return { sizeBytes, contentType: head.ContentType, head: bytes };
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e?.name === "NotFound" || e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

/** Best-effort removal of objects that will never be referenced. */
export async function deletePhotoObjects(s: PhotoStorage, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await s.client.send(
      new DeleteObjectsCommand({ Bucket: s.bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } })
    );
  } catch (err) {
    console.error("[visit-photos] could not delete unused uploads:", err);
  }
}

// ─── Request parsing for "start the visit" ────────────────────────────────────

export interface StartPhoto {
  key: string;
  name: string | null;
  contentType: string;
  sizeBytes: number;
}

/** Result of parseStartPhotos: either `photos`, or an `error` with its `code`. */
export interface ParsedStartPhotos {
  photos: StartPhoto[];
  error: string | null;
  code: string | null;
}

const rejectStart = (error: string, code: string): ParsedStartPhotos => ({ photos: [], error, code });

/**
 * Validate the `photos` list sent with Open Visit. Every key must be one this
 * app issued for THIS visit, with a supported type matching its extension.
 */
export function parseStartPhotos(visitId: string, raw: unknown): ParsedStartPhotos {
  if (!Array.isArray(raw) || raw.length === 0) {
    return rejectStart(PHOTO_REQUIRED_MESSAGE, "PHOTO_REQUIRED");
  }
  if (raw.length > VISIT_PHOTO_MAX_COUNT) {
    return rejectStart(`You can upload up to ${VISIT_PHOTO_MAX_COUNT} photos per visit.`, "TOO_MANY_PHOTOS");
  }
  const seen = new Set<string>();
  const photos: StartPhoto[] = [];
  for (const item of raw) {
    const p = item as { key?: unknown; name?: unknown; contentType?: unknown; size?: unknown };
    const key = typeof p?.key === "string" ? p.key : "";
    const contentType = typeof p?.contentType === "string" ? p.contentType : "";
    const size = typeof p?.size === "number" ? p.size : NaN;
    if (!isVisitPhotoKey(visitId, key) || contentTypeForKey(key) !== contentType) {
      return rejectStart("One of the photos does not belong to this visit. Please upload it again.", "INVALID_PHOTO");
    }
    if (!Number.isInteger(size) || size <= 0 || size > VISIT_PHOTO_MAX_BYTES) {
      return rejectStart("One of the photos has an invalid size. Please upload it again.", "INVALID_PHOTO");
    }
    if (seen.has(key)) continue;
    seen.add(key);
    photos.push({ key, name: cleanOriginalName(p.name), contentType, sizeBytes: size });
  }
  return { photos, error: null, code: null };
}
