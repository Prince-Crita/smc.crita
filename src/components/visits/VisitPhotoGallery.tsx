"use client";

import { useCallback, useState } from "react";
import { Camera, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, MapPin, AlertCircle, ExternalLink, ImageOff } from "lucide-react";
import { cn, formatDateTime } from "@/lib/utils/utils";
import { assetPath } from "@/lib/utils/asset-path";
import { fetchJSON } from "@/lib/hooks/useLiveQuery";
import { Modal } from "@/components/ui/Modal";

// ─── Geotagged Images ─────────────────────────────────────────────────────────
// Compact, collapsed-by-default section listing the photos an executive
// uploaded when starting a visit. Nothing is downloaded until it is expanded:
// opening it fetches only the photo list (GET /api/visits/[visitId]/photos,
// which carries no image links). Each image is then requested from
// /api/visits/[visitId]/photos/[photoId] at the moment it is shown —
// thumbnails lazily, the large preview when tapped — and that endpoint checks
// access and signs a 2-minute S3 link for that one image only then.
//
// GPS coordinates are shown only when they were read from the image file
// itself; otherwise the preview says so plainly.

interface VisitPhoto {
  id: string;
  originalName: string | null;
  contentType: string;
  sizeBytes: number;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  createdAt: string;
  uploadedBy: { id: string; name: string };
}

const TONES = {
  light: {
    card: "bg-white border border-[#e2e7f0] rounded-xl shadow-sm",
    header: "hover:bg-[#f8f9fc]",
    title: "text-[#0f1829]",
    muted: "text-[#8896a9]",
    icon: "text-[#25488e]",
    divider: "border-[#e2e7f0]",
    thumb: "border-[#e2e7f0] bg-[#f1f4f9] hover:border-[#25488e]",
  },
  dark: {
    card: "bg-slate-900 border border-slate-800 rounded-2xl",
    header: "hover:bg-slate-800/40",
    title: "text-white",
    muted: "text-slate-400",
    icon: "text-blue-400",
    divider: "border-slate-800",
    thumb: "border-slate-700 bg-slate-800 hover:border-blue-400",
  },
} as const;

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function VisitPhotoGallery({
  visitId,
  photoCount,
  summary,
  tone = "light",
}: {
  visitId: string;
  /** Number of photos on the visit (shown while collapsed, before loading). */
  photoCount: number;
  /** Optional one-line note under the title, e.g. who uploaded and when. */
  summary?: string;
  tone?: "light" | "dark";
}) {
  const t = TONES[tone];
  const [isOpen, setIsOpen] = useState(false);
  const [photos, setPhotos] = useState<VisitPhoto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [storageConfigured, setStorageConfigured] = useState(true);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  // Photos whose image could not be opened (shown as a placeholder instead).
  const [failed, setFailed] = useState<Set<string>>(() => new Set());

  /** The app address that opens one photo (signs its S3 link on request). */
  const photoSrc = (photoId: string) => assetPath(`/api/visits/${visitId}/photos/${photoId}`);
  const markFailed = (photoId: string) => setFailed((prev) => new Set(prev).add(photoId));

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setFailed(new Set());
    try {
      const data = await fetchJSON<{ photos: VisitPhoto[]; storageConfigured: boolean }>(`/api/visits/${visitId}/photos`);
      setPhotos(data.photos);
      setStorageConfigured(data.storageConfigured);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the photos");
    } finally {
      setLoading(false);
    }
  }, [visitId]);

  const toggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    if (next && photoCount > 0) void load();
  };

  const preview = previewIndex !== null && photos ? photos[previewIndex] : null;

  return (
    <div className={t.card}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        className={cn("w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors rounded-xl", t.header)}
      >
        <Camera className={cn("w-4 h-4 flex-shrink-0", t.icon)} />
        <div className="flex-1 min-w-0">
          <p className={cn("text-sm font-semibold", t.title)}>
            Geotagged Images <span className={cn("font-normal", t.muted)}>({photoCount})</span>
          </p>
          {summary && <p className={cn("text-xs mt-0.5 truncate", t.muted)}>{summary}</p>}
        </div>
        {isOpen
          ? <ChevronUp className={cn("w-4 h-4 flex-shrink-0", t.muted)} />
          : <ChevronDown className={cn("w-4 h-4 flex-shrink-0", t.muted)} />}
      </button>

      {isOpen && (
        <div className={cn("px-5 pb-4 pt-3 border-t", t.divider)}>
          {photoCount === 0 ? (
            <p className={cn("text-xs", t.muted)}>No geotagged images were uploaded for this visit.</p>
          ) : loading && !photos ? (
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: Math.min(photoCount, 6) }).map((_, i) => (
                <div key={i} className={cn("w-20 h-20 rounded-lg border animate-pulse", t.thumb)} />
              ))}
            </div>
          ) : error ? (
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-red-500">{error}</p>
                <button type="button" onClick={() => void load()} className="text-xs font-semibold text-[#25488e] hover:underline mt-0.5">
                  Try again
                </button>
              </div>
            </div>
          ) : photos ? (
            <>
              {!storageConfigured && (
                <p className={cn("text-xs mb-2", t.muted)}>Photo storage is not configured, so the images cannot be shown.</p>
              )}
              <div className="flex flex-wrap gap-2">
                {photos.map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPreviewIndex(i)}
                    aria-label={`View photo ${i + 1}`}
                    className={cn("relative w-20 h-20 rounded-lg overflow-hidden border transition-colors flex items-center justify-center", t.thumb)}
                  >
                    {storageConfigured && !failed.has(p.id) ? (
                      // eslint-disable-next-line @next/next/no-img-element -- opened through the app, which signs a short-lived S3 link
                      <img
                        src={photoSrc(p.id)}
                        alt={p.originalName ?? `Visit photo ${i + 1}`}
                        loading="lazy"
                        decoding="async"
                        onError={() => markFailed(p.id)}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <ImageOff className={cn("w-5 h-5", t.muted)} />
                    )}
                    {p.gpsLatitude !== null && p.gpsLongitude !== null && (
                      <span className="absolute bottom-1 right-1 p-0.5 rounded bg-black/55">
                        <MapPin className="w-3 h-3 text-white" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <p className={cn("text-[11px] mt-2", t.muted)}>Tap a photo to view it larger.</p>
            </>
          ) : null}
        </div>
      )}

      {preview && photos && previewIndex !== null && (
        <Modal
          isOpen
          title={`Visit Photo ${previewIndex + 1} of ${photos.length}`}
          onClose={() => setPreviewIndex(null)}
          size="xl"
          overlayClassName="pb-16 sm:pb-0"
        >
          <div className="p-4 space-y-3">
            <div className="relative bg-[#0f1829] rounded-xl overflow-hidden flex items-center justify-center min-h-[200px]">
              {storageConfigured && !failed.has(preview.id) ? (
                // eslint-disable-next-line @next/next/no-img-element -- opened through the app, which signs a short-lived S3 link
                <img
                  src={photoSrc(preview.id)}
                  alt={preview.originalName ?? "Visit photo"}
                  onError={() => markFailed(preview.id)}
                  className="max-w-full max-h-[65vh] object-contain"
                />
              ) : (
                <p className="text-sm text-slate-300 py-16">Image unavailable</p>
              )}
              {photos.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setPreviewIndex((previewIndex - 1 + photos.length) % photos.length)}
                    aria-label="Previous photo"
                    className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewIndex((previewIndex + 1) % photos.length)}
                    aria-label="Next photo"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>

            <div className="space-y-1.5 text-xs text-[#4a5568]">
              <p>
                Uploaded by <span className="font-semibold text-[#0f1829]">{preview.uploadedBy.name}</span> · {formatDateTime(preview.createdAt)}
              </p>
              <p className="text-[#8896a9] truncate">
                {preview.originalName ?? "Photo"} · {formatSize(preview.sizeBytes)}
              </p>
              {preview.gpsLatitude !== null && preview.gpsLongitude !== null ? (
                <p className="flex items-center gap-1.5 flex-wrap">
                  <MapPin className="w-3.5 h-3.5 text-[#25488e]" />
                  GPS from image file: {preview.gpsLatitude.toFixed(6)}, {preview.gpsLongitude.toFixed(6)}
                  <a
                    href={`https://www.google.com/maps?q=${preview.gpsLatitude},${preview.gpsLongitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-[#25488e] hover:underline inline-flex items-center gap-0.5"
                  >
                    View on map <ExternalLink className="w-3 h-3" />
                  </a>
                </p>
              ) : (
                <p className="text-[#8896a9]">No GPS data in this image file (a location printed on the photo is still visible above).</p>
              )}
              {storageConfigured && !failed.has(preview.id) && (
                <a
                  href={photoSrc(preview.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-[#25488e] hover:underline"
                >
                  Open full size <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
