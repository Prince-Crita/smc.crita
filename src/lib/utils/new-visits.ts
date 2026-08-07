"use client";

/**
 * Transient "New" badge for freshly assigned visits.
 *
 * PURELY VISUAL. This never touches Visit.status, progress, carry-forward or
 * any server state — it only answers "has this executive's browser shown this
 * visit id before?".
 *
 * How the badge disappears on refresh / navigation:
 * the ids are marked as seen the moment they are first rendered, so the very
 * next load (refresh, or navigating away and back) finds them already seen and
 * returns nothing. The badge is therefore visible exactly once.
 *
 * First run on a device records the current ids WITHOUT flagging any of them,
 * so an executive opening the app for the first time does not see every visit
 * light up as "New".
 */

const STORAGE_KEY = "smc_seen_visit_ids";
/** Keep the list bounded; oldest ids fall off once a device has seen many. */
const MAX_TRACKED = 500;

function read(): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : null;
  } catch {
    return null; // storage blocked / corrupt — feature simply stays off
  }
}

function write(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(-MAX_TRACKED)));
  } catch {
    /* storage unavailable — no badge, no error */
  }
}

/**
 * Returns the ids that are new since this device last looked, and marks every
 * supplied id as seen so the badge does not survive a refresh.
 */
export function markVisitsSeen(currentIds: string[]): Set<string> {
  const ids = currentIds.filter((id) => typeof id === "string" && id);
  const seen = read();

  // First run on this device: establish the baseline silently.
  if (seen === null) {
    write(ids);
    return new Set();
  }

  const seenSet = new Set(seen);
  const fresh = ids.filter((id) => !seenSet.has(id));

  // Mark everything currently visible as seen, keeping previously seen ids so
  // a visit that scrolls out of the list is not re-flagged later.
  if (fresh.length > 0) write([...seen, ...fresh]);

  return new Set(fresh);
}
