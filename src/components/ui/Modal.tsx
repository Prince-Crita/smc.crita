/**
 * Modal.tsx - Portal-based modal dialog
 *
 * Uses ReactDOM.createPortal to escape ALL parent stacking contexts
 * (overflow-auto scroll containers, CSS transforms, backdrop-filter).
 * This ensures `fixed` positioning is always viewport-relative.
 *
 * Two variants:
 *   1. Regular (default): centered card, 95vw, max-h-[90dvh].
 *   2. fullScreenOnMobile: full screen on mobile, centered card on sm+.
 *
 * overlayClassName: inject extra classes on the portal root.
 *   e.g. overlayClassName="pb-16 sm:pb-0" to avoid the executive bottom nav.
 */

"use client";

import { useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/utils";

const SIZE: Record<string, string> = {
  sm:   "sm:max-w-sm",
  md:   "sm:max-w-lg",
  lg:   "sm:max-w-2xl",
  xl:   "sm:max-w-4xl",
  full: "sm:max-w-6xl",
};

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  fullScreenOnMobile?: boolean;
  overlayClassName?: string;
}

// -- Shared header (module-level so it isn't recreated every render) --
function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-[#e2e7f0]">
      <h2
        id="modal-title"
        className="text-base font-bold text-[#0f1829] leading-tight truncate"
      >
        {title}
      </h2>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="flex-shrink-0 ml-3 p-1.5 rounded-lg text-[#8896a9] hover:text-[#0f1829] hover:bg-[#f1f4f9] transition-colors press-effect"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = "md",
  fullScreenOnMobile = false,
  overlayClassName,
}: ModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  /* -- Lock body scroll -- */
  useEffect(() => {
    if (!isOpen) return;
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, [isOpen]);

  /* -- ESC to close -- */
  const handleKey = useCallback(
    (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); },
    [onClose],
  );
  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, handleKey]);

  if (!isOpen) return null;

  const modalContent = fullScreenOnMobile ? (
    <div
      className={cn(
        "fixed inset-0 z-[9999]",
        "flex flex-col sm:items-center sm:justify-center sm:p-4",
        overlayClassName,
      )}
      aria-modal="true"
      role="dialog"
      aria-labelledby="modal-title"
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm hidden sm:block"
        aria-hidden="true"
        onClick={onClose}
      />

      <div
        className={cn(
          "relative z-10 bg-white flex flex-col",
          "w-full h-[100dvh] rounded-none border-0",
          "sm:h-auto sm:max-h-[88vh]",
          "sm:w-[90vw]",
          "sm:border sm:border-[#e2e7f0]",
          "sm:rounded-2xl sm:shadow-2xl",
          SIZE[size ?? "md"],
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <ModalHeader title={title} onClose={onClose} />
        {/* Scrolls at EVERY size. The overflow rule used to be `sm:`-only, so
            on a phone this pane had no scroller while its panel was pinned to
            h-[100dvh] — content past the fold (e.g. the lower carry-forward
            clients) was simply unreachable. The header stays put because the
            panel is a flex column and this pane is the only growing child;
            overscroll-contain keeps the page behind from taking over the
            gesture at the ends of the list. */}
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </div>
    </div>
  ) : (
    <div
      ref={backdropRef}
      className={cn(
        "fixed inset-0 z-[9999]",
        "flex items-center justify-center",
        "p-4",
        overlayClassName,
      )}
      aria-modal="true"
      role="dialog"
      aria-labelledby="modal-title"
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className={cn(
          "relative z-10 flex flex-col",
          "bg-white border border-[#e2e7f0] shadow-2xl rounded-2xl",
          "w-[95vw] sm:w-[90vw]",
          "max-h-[90dvh]",
          SIZE[size ?? "md"],
          "animate-in-scale",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <ModalHeader title={title} onClose={onClose} />
        <div className="flex-1 overflow-y-auto overscroll-contain min-h-0">
          {children}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
