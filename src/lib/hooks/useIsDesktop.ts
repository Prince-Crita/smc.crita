"use client";

import { useSyncExternalStore } from "react";

/**
 * useIsDesktop
 * -----------------------------------------------------------------------
 * True when the viewport is at or above Tailwind's `md` breakpoint (768px) —
 * the same boundary the `md:hidden` / `hidden md:block` classes use.
 *
 * Why this exists: the heaviest screens in the app ship a desktop layout AND
 * a separate mobile layout in the same component, and let CSS hide one of
 * them. CSS hides — it does not skip. Both trees were being built by React,
 * reconciled on every state change and mounted into the DOM on every device:
 * the admin dashboard rendered its whole desktop half (including the charts)
 * on a phone, and its whole mobile half on a desktop, and the visit list
 * rendered every visit twice, once as a table row and once as a card.
 *
 * Gating on this hook means only the layout actually being looked at is
 * built. The wrapper's `md:hidden` / `hidden md:block` classes are kept
 * exactly as they were, so CSS remains the authority on what is visible and
 * the rendered result is pixel-identical — this only stops the other half
 * from being constructed.
 *
 * `useSyncExternalStore` (rather than useState + an effect) is what keeps
 * this hydration-safe: React renders the server snapshot during hydration and
 * re-renders once with the real value immediately afterwards, with no
 * mismatch warning and no extra render on every resize event.
 */

const MD_QUERY = "(min-width: 768px)";

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(MD_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(MD_QUERY).matches;
}

// The server has no viewport. Desktop is the safe default: the pages using
// this render a loading skeleton until their data arrives, so the first
// client render already replaces whatever was sent.
function getServerSnapshot(): boolean {
  return true;
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
