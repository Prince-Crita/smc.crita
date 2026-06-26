/**
 * Modal.tsx — Portal-based modal dialog
 *
 * ROOT CAUSE OF PREVIOUS BUGS:
 *   The dashboard layout has:
 *     <main className="overflow-auto ...">        ← creates scroll stacking context
 *     <Sidebar className="translate-x-0 ...">     ← CSS transform creates stacking context
 *     <header className="backdrop-blur-md ...">   ← filter creates stacking context
 *
 *   Any of these makes `position: fixed` children position relative to THAT
 *   element instead of the viewport — so modals appeared attached to the
 *   scroll container, below center, or behind the bottom nav.
 *
 * THE FIX: ReactDOM.createPortal
 *   Renders the modal HTML directly on <body>, completely outside every
 *   stacking context in the app tree. After the portal, the modal's
 *   `fixed` positioning is always relative to the true viewport.
 *
 * Two variants:
 *   1. Regular (default): centered card, 95vw, max-h-[90dvh], all screen sizes.
 *   2. fullScreenOnMobile: full screen on mobile, centered card on sm+.
 *      Children own their scroll (no double-scroll deadlock).
 *
 * overlayClassName: inject extra classes on the portal root for offset centering.
 *   e.g. overlayClassName="pb-16 sm:pb-0" to avoid the executive bottom nav.
 */

"use client";

import { useEffect, useRef, useCallback, useState } from "react";
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
  /**
   * Full-screen sheet on mobile, centered card on sm+.
   * Children must own their scroll container (use flex-1 + overflow-y-auto inside).
   */
  fullScreenOnMobile?: boolean;
  /**
   * Extra Tailwind classes applied to the portal root element.
   * Use to add bottom-padding offset for fixed navigation bars:
   *   overlayClassName="pb-16 sm:pb-0"
   */
  overlayClassName?: string;
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
  // Portal target: document.body. Null during SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const backdropRef = useRef<HTMLDivElement>(null);

  /* ── Lock body scroll while open (body + html for iOS Safari) ───────────── */
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

  /* ── ESC to close ────────────────────────────────────────────────────────── */
  const handleKey = useCallback(
    (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); },
    [onClose],
  );
  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, handleKey]);

  // Don't render during SSR or when closed
  if (!mounted || !isOpen) return null;

  /* ───────────────────────────────────────────────────────────────────────────
   * MODAL CONTENT
   * Rendered via createPortal → appended directly to document.body.
   * This escapes ALL parent stacking contexts (overflow-auto, transforms,
   * backdrop-filter) so `fixed` positioning is always viewport-relative.
   * ─────────────────────────────────────────────────────────────────────────── */

  const modalContent = fullScreenOnMobile
    ? (
      /* ── VARIANT A: Full-screen sheet on mobile ────────────────────────────
       * Mobile:  fills 100dvh entirely (no rounding, no border)
       *          Children own their internal scroll to avoid double-scroll.
       * sm+:     reverts to centered card
       */
      <div
        className={cn(
          // Portal root: fixed, covers full viewport, stacks above everything
          "fixed inset-0 z-[9999]",
          "flex flex-col sm:items-center sm:justify-center sm:p-4",
          overlayClassName,
        )}
        aria-modal="true"
        role="dialog"
        aria-labelledby="modal-title"
      >
        {/* Backdrop — only visible on sm+ where modal is a card, not full-screen */}
        <div
          className="absolute inset-0 bg-black/75 backdrop-blur-sm hidden sm:block"
          aria-hidden="true"
          onClick={onClose}
        />

        {/* Panel */}
        <div
          className={cn(
            "relative z-10 bg-slate-900 flex flex-col",
            // Mobile: true full-screen
            "w-full h-[100dvh] rounded-none border-0",
            // sm+: centered card
            "sm:h-auto sm:max-h-[88vh]",
            "sm:w-[90vw]",
            "sm:border sm:border-slate-700",
            "sm:rounded-2xl sm:shadow-2xl",
            SIZE[size ?? "md"],
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Fixed header */}
          <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-800/80 bg-slate-900">
            <h2
              id="modal-title"
              className="text-base font-semibold text-white leading-tight truncate"
            >
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex-shrink-0 ml-3 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors press-effect"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/*
           * Content — NO overflow-y-auto here.
           * Children own their scroll (prevents double-scroll deadlock).
           * sm:overflow-y-auto as fallback for desktop h-auto panels.
           */}
          <div className="flex flex-col flex-1 min-h-0 sm:overflow-y-auto sm:overscroll-contain">
            {children}
          </div>
        </div>
      </div>
    )
    : (
      /* ── VARIANT B: Centered modal (default, all screen sizes) ────────────
       *
       * Positioning: fixed inset-0 + flex items-center justify-center + p-4
       *   - items-center: vertical center (NOT items-end which caused bottom-snap)
       *   - p-4: 16px gap from all edges → works on 320px phones
       *
       * Panel sizing:
       *   - w-[95vw]: 95% viewport width on mobile (320px → 304px usable)
       *   - sm:w-[90vw]: slightly wider on tablets
       *   - SIZE[size]: max-w cap on larger screens
       *   - max-h-[90dvh]: dvh is iOS-Safari-safe (vh includes browser toolbar)
       *
       * overlayClassName: add pb-16 sm:pb-0 to offset 64px executive bottom nav.
       */
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
          className="absolute inset-0 bg-black/75 backdrop-blur-sm"
          aria-hidden="true"
        />

        {/* Panel */}
        <div
          className={cn(
            "relative z-10 flex flex-col",
            "bg-slate-900 border border-slate-700 shadow-2xl rounded-2xl",
            "w-[95vw] sm:w-[90vw]",
            "max-h-[90dvh]",
            SIZE[size ?? "md"],
            "animate-in-scale",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Fixed header */}
          <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-800/80">
            <h2
              id="modal-title"
              className="text-base font-semibold text-white leading-tight truncate"
            >
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex-shrink-0 ml-3 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors press-effect"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/*
           * Scrollable content.
           * min-h-0: mandatory — without it, flex-1 ignores max-h-[90dvh]
           *          and overflow-y-auto never activates.
           */}
          <div className="flex-1 overflow-y-auto overscroll-contain min-h-0">
            {children}
          </div>
        </div>
      </div>
    );

  // Teleport to document.body — escapes ALL parent stacking contexts
  return createPortal(modalContent, document.body);
}
