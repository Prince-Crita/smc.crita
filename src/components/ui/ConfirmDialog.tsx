/**
 * ConfirmDialog - in-app replacement for window.confirm().
 *
 * Browser confirm() popups are forbidden in this application. Use this
 * component for every destructive/confirm action instead. It is built on the
 * existing Modal (portal-based, centered, backdrop-blocked, ESC-to-cancel,
 * responsive, same animations as every other dialog in the design system).
 *
 * Usage:
 *   const [confirmState, setConfirmState] = useState<null | { ... }>(null);
 *   <ConfirmDialog
 *     isOpen={!!confirmState}
 *     title="Archive client"
 *     message={`Archive "${name}"?`}
 *     confirmLabel="Archive"
 *     danger
 *     onConfirm={() => { ...; setConfirmState(null); }}
 *     onCancel={() => setConfirmState(null)}
 *   />
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, HelpCircle } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils/utils";

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  /** Main message. Can be multi-line; rendered as normal text. */
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red styling for destructive actions (delete/archive/remove). */
  danger?: boolean;
  /** Called when the user confirms. May be async - a spinner state is shown. */
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus the confirm button when the dialog opens (keyboard accessibility -
  // Enter confirms, ESC cancels via the Modal's existing handler).
  useEffect(() => {
    if (isOpen) {
      setBusy(false);
      const t = setTimeout(() => confirmRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  const handleConfirm = async () => {
    try {
      setBusy(true);
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={() => !busy && onCancel()} title={title} size="sm">
      <div className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className={cn(
            "w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0",
            danger ? "bg-red-50" : "bg-[#eef2fb]"
          )}>
            {danger
              ? <AlertTriangle className="w-5 h-5 text-red-500" />
              : <HelpCircle className="w-5 h-5 text-[#25488e]" />}
          </div>
          <div className="text-sm text-[#4a5568] leading-relaxed pt-1.5">{message}</div>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-lg bg-[#f1f4f9] hover:bg-[#e2e7f0] text-[#4a5568] text-sm font-semibold transition-colors border border-[#e2e7f0] disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            disabled={busy}
            onClick={handleConfirm}
            className={cn(
              "flex-1 py-2.5 rounded-lg text-white text-sm font-semibold transition-colors disabled:opacity-50",
              danger
                ? "bg-red-600 hover:bg-red-700"
                : "bg-[#25488e] hover:bg-[#1e3a72]"
            )}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
