"use client";

import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { ImagePlus, X, CheckCircle2, AlertCircle, Camera, PlayCircle } from "lucide-react";
import { cn } from "@/lib/utils/utils";
import { Modal } from "@/components/ui/Modal";

// ─── Start Company Visit ──────────────────────────────────────────────────────
// Shown when an executive presses Open Visit. Starting a visit requires at
// least one geotagged photo (taken beforehand with the executive's geotag
// camera app and picked here from the phone gallery). The flow:
//
//   1. pick photo(s)      — previews, remove mistakes; nothing is sent yet
//   2. Start Visit        — the server hands out signed upload URLs for this
//                           visit; each photo is PUT straight to S3 (photos
//                           are too large to pass through the app's own API)
//   3. open the visit     — the existing Open Visit request, now carrying the
//                           uploaded photo keys; the server verifies them and
//                           starts the visit in the same step
//
// A failure at any point leaves the visit PENDING. Photos already uploaded
// stay uploaded, so "Start Visit" again only retries what is missing.
// The server enforces the same rules — this popup is convenience, not the
// security boundary.

const MAX_PHOTOS = 10;
const MAX_BYTES = 15 * 1024 * 1024;
const REQUIRED_MESSAGE = "Please upload at least one geotagged visit photo before starting the visit.";
const ALLOWED_TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

type ItemStatus = "ready" | "uploading" | "uploaded" | "error";

interface PhotoItem {
  id: string;
  file: File;
  contentType: string;
  previewUrl: string;
  status: ItemStatus;
  progress: number;
  key: string | null;
}

/** The photo's type, from the browser or (when the picker gives none) its extension. */
function photoContentType(file: File): string | null {
  if (Object.values(ALLOWED_TYPES).includes(file.type)) return file.type;
  if (file.type && file.type !== "application/octet-stream") return null;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ALLOWED_TYPES[ext] ?? null;
}

/** PUT one file to its signed S3 URL, reporting progress. */
function uploadToSignedUrl(
  url: string,
  file: File,
  contentType: string,
  onProgress: (pct: number) => void,
  xhrRef: { current: XMLHttpRequest | null }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      xhrRef.current = null;
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Photo upload was rejected (${xhr.status}). Please try again.`));
    };
    xhr.onerror = () => {
      xhrRef.current = null;
      reject(new Error("Photo upload failed. Please check your internet connection and try again."));
    };
    xhr.onabort = () => {
      xhrRef.current = null;
      reject(new Error("Upload cancelled."));
    };
    xhr.send(file);
  });
}

export function StartVisitModal({
  visitId,
  clientName,
  onClose,
  onStarted,
}: {
  visitId: string;
  clientName: string;
  onClose: () => void;
  /** Called after the visit has been started successfully. */
  onStarted: () => void;
}) {
  const [items, setItems] = useState<PhotoItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const itemsRef = useRef<PhotoItem[]>([]);
  useEffect(() => { itemsRef.current = items; }, [items]);

  // Release preview URLs and stop any upload when the popup goes away.
  useEffect(() => () => {
    xhrRef.current?.abort();
    itemsRef.current.forEach((i) => URL.revokeObjectURL(i.previewUrl));
  }, []);

  const update = (id: string, patch: Partial<PhotoItem>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const addFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setError("");
    const problems: string[] = [];
    const additions: PhotoItem[] = [];
    const existing = new Set(items.map((i) => `${i.file.name}|${i.file.size}|${i.file.lastModified}`));
    for (const file of Array.from(list)) {
      const contentType = photoContentType(file);
      const sig = `${file.name}|${file.size}|${file.lastModified}`;
      if (existing.has(sig)) continue;
      if (!contentType) { problems.push(`"${file.name}" is not a JPG, PNG or WebP photo.`); continue; }
      if (file.size === 0) { problems.push(`"${file.name}" is empty.`); continue; }
      if (file.size > MAX_BYTES) { problems.push(`"${file.name}" is larger than 15 MB.`); continue; }
      if (items.length + additions.length >= MAX_PHOTOS) { problems.push(`You can add up to ${MAX_PHOTOS} photos.`); break; }
      existing.add(sig);
      additions.push({
        id: `${sig}|${Math.random().toString(36).slice(2)}`,
        file,
        contentType,
        previewUrl: URL.createObjectURL(file),
        status: "ready",
        progress: 0,
        key: null,
      });
    }
    if (additions.length) setItems((prev) => [...prev, ...additions]);
    if (problems.length) setError(problems.join(" "));
  };

  const removeItem = (id: string) => {
    setItems((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
    setError("");
  };

  const handleClose = () => {
    xhrRef.current?.abort();
    onClose();
  };

  const startVisit = async () => {
    if (items.length === 0) {
      setError(REQUIRED_MESSAGE);
      return;
    }
    setBusy(true);
    setError("");
    const keyById = new Map(items.filter((i) => i.key).map((i) => [i.id, i.key as string]));
    try {
      // 1. Upload every photo not uploaded yet (first attempt, or a retry).
      const pending = items.filter((i) => !i.key);
      if (pending.length > 0) {
        setStage("Preparing upload…");
        const res = await fetch(`/api/visits/${visitId}/photos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files: pending.map((i) => ({ name: i.file.name, type: i.contentType, size: i.file.size })) }),
        });
        const data = await res.json().catch(() => ({})) as { uploads?: { key: string; url: string; contentType: string }[]; error?: string };
        if (!res.ok || !data.uploads || data.uploads.length !== pending.length) {
          throw new Error(data.error || "Could not prepare the photo upload. Please try again.");
        }
        for (let n = 0; n < pending.length; n++) {
          const item = pending[n];
          const upload = data.uploads[n];
          setStage(`Uploading photo ${n + 1} of ${pending.length}…`);
          update(item.id, { status: "uploading", progress: 0 });
          try {
            await uploadToSignedUrl(upload.url, item.file, upload.contentType, (pct) => update(item.id, { progress: pct }), xhrRef);
          } catch (err) {
            update(item.id, { status: "error", progress: 0 });
            throw err;
          }
          keyById.set(item.id, upload.key);
          update(item.id, { status: "uploaded", progress: 100, key: upload.key });
        }
      }

      // 2. Start the visit — the server verifies the uploads first.
      setStage("Starting visit…");
      const photos = items.map((i) => ({
        key: keyById.get(i.id),
        name: i.file.name,
        contentType: i.contentType,
        size: i.file.size,
      }));
      const res = await fetch(`/api/visits/${visitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photos }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to start the visit. Please try again.");

      toast.success("Visit started");
      onStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
      setStage("");
    }
  };

  const uploadedCount = items.filter((i) => i.status === "uploaded").length;
  const overall = items.length === 0 ? 0 : Math.round(items.reduce((s, i) => s + i.progress, 0) / items.length);

  return (
    <Modal isOpen title="Start Company Visit" onClose={handleClose} size="md" overlayClassName="pb-16 sm:pb-0">
      <div className="p-5 space-y-4">
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-[#eef2fb] border border-[#d4ddf5]">
          <Camera className="w-4 h-4 text-[#25488e] flex-shrink-0 mt-0.5" />
          <div className="text-xs text-[#4a5568] space-y-0.5">
            <p className="font-semibold text-[#0f1829]">Upload geotagged visit photos for {clientName}</p>
            <p>Take the photo with your geotag camera app first, then choose it from your gallery here. At least one photo is required to start the visit.</p>
          </div>
        </div>

        {/* Thumbnails */}
        {items.length > 0 && (
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
            {items.map((item) => (
              <div key={item.id} className="relative aspect-square rounded-lg overflow-hidden border border-[#e2e7f0] bg-[#f1f4f9]">
                {/* eslint-disable-next-line @next/next/no-img-element -- local preview of a picked file */}
                <img src={item.previewUrl} alt={item.file.name} className="w-full h-full object-cover" />
                {item.status === "uploading" && (
                  <div className="absolute inset-x-0 bottom-0 h-1.5 bg-black/30">
                    <div className="h-full bg-[#25488e] transition-all" style={{ width: `${item.progress}%` }} />
                  </div>
                )}
                {item.status === "uploaded" && (
                  <span className="absolute bottom-1 left-1 rounded-full bg-white">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                  </span>
                )}
                {item.status === "error" && (
                  <span className="absolute bottom-1 left-1 rounded-full bg-white">
                    <AlertCircle className="w-4 h-4 text-red-600" />
                  </span>
                )}
                {!busy && (
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    aria-label={`Remove ${item.file.name}`}
                    className="absolute top-1 right-1 p-0.5 rounded-full bg-black/55 text-white hover:bg-black/75"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Picker — a label around a visually hidden input works in mobile
            browsers and the Android app's WebView, where it opens the gallery. */}
        <label
          className={cn(
            "flex items-center justify-center gap-2 w-full py-3 rounded-xl border-2 border-dashed text-sm font-semibold transition-colors",
            busy || items.length >= MAX_PHOTOS
              ? "border-[#e2e7f0] text-[#c8d2e0] cursor-not-allowed"
              : "border-[#adc2e2] text-[#25488e] hover:bg-[#eef2f9] cursor-pointer"
          )}
        >
          <ImagePlus className="w-4 h-4" />
          {items.length === 0 ? "Add Photos" : "Add More Photos"}
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={busy || items.length >= MAX_PHOTOS}
            onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
            className="sr-only"
          />
        </label>

        <p className="text-[11px] text-[#8896a9]">
          {items.length === 0
            ? `JPG, PNG or WebP · up to ${MAX_PHOTOS} photos · 15 MB each`
            : `${items.length} photo${items.length === 1 ? "" : "s"} selected${uploadedCount ? ` · ${uploadedCount} uploaded` : ""} · up to ${MAX_PHOTOS}`}
        </p>

        {busy && stage && (
          <div className="space-y-1.5">
            <p className="text-xs text-[#4a5568]">{stage}</p>
            <div className="h-1.5 bg-[#f1f4f9] rounded-full overflow-hidden">
              <div className="h-full bg-[#25488e] rounded-full transition-all" style={{ width: `${overall}%` }} />
            </div>
          </div>
        )}

        {error ? (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-600">{error}</p>
          </div>
        ) : items.length === 0 ? (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">{REQUIRED_MESSAGE}</p>
        ) : null}
      </div>

      <div className="sticky bottom-0 bg-white px-5 py-4 border-t border-[#e2e7f0] flex gap-3">
        <button
          type="button"
          onClick={handleClose}
          className="flex-1 py-2.5 bg-[#f1f4f9] hover:bg-[#e2e7f0] border border-[#e2e7f0] text-[#4a5568] text-sm font-semibold rounded-xl transition-all"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={startVisit}
          disabled={busy || items.length === 0}
          id="start-visit-btn"
          className="flex-1 py-2.5 bg-[#25488e] hover:bg-[#1e3a72] disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all flex items-center justify-center gap-2 press-effect"
        >
          {busy ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Please wait…
            </>
          ) : (
            <>
              <PlayCircle className="w-4 h-4" />
              {uploadedCount > 0 && uploadedCount < items.length ? "Retry & Start Visit" : "Start Visit"}
            </>
          )}
        </button>
      </div>
    </Modal>
  );
}
