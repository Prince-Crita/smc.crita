// ─── Attendance day-boundary helpers ───────────────────────────────────────
// The business operates in IST (UTC+5:30 — see Asia/Kolkata usage throughout
// the UI, e.g. the late-punch-in cutoff already treats 04:30 UTC as 10:00 IST).
// Attendance rows are keyed by (executiveId, date) where `date` must represent
// a single IST calendar day. Using raw UTC midnight as that key is wrong: UTC
// midnight is 05:30 IST, so for the first ~5.5 hours of every IST day
// (00:00–05:29 IST) `toMidnightUTC(new Date())` still resolves to YESTERDAY's
// IST date, causing punch-in/out to read or write the previous day's record
// (symptom: "Day Completed" still showing after midnight IST on a new day).
//
// toMidnightIST returns the UTC instant equal to IST midnight of the current
// IST calendar day, so it can be used directly as the unique `date` key and
// round-trips consistently between writes (punch in/out) and reads (GET).
//
// NOTE: This is intentionally separate from `toMidnightUTC` in
// `src/lib/utils/leave-check.ts`, which stays UTC-based for leave-date
// semantics — only attendance's day boundary is affected by this fix.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Normalize a date to midnight IST (UTC+5:30), returned as a UTC instant. */
/**
 * The IST calendar date of `d` as "YYYY-MM-DD".
 *
 * Use this instead of `new Date().toISOString().split("T")[0]` anywhere a date
 * is sent to an attendance endpoint. Between 00:00 and 05:30 IST the UTC date
 * is still the PREVIOUS day, so a UTC-derived string asks the API for the
 * wrong IST day and today's punch-ins drop out of the result (executives who
 * had punched in showed as "Absent"). The API already keys and filters by the
 * IST day — this keeps the caller on the same boundary.
 */
export function istDateString(d: Date = new Date()): string {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  return shifted.toISOString().split("T")[0];
}

/**
 * Attendance status of a punch-in (Phase 2, requirement 9), in IST:
 *   10:00 AM – 7:30 PM  → On Time
 *   after 7:30 PM       → Late
 * A punch-in before 10:00 AM is early, not late, so it is On Time as well.
 * Judged to the minute: 7:30 PM itself is On Time, 7:31 PM is Late.
 */
export function isLatePunchIn(d: Date): boolean {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  const minutesIST = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  return minutesIST > 19 * 60 + 30;
}

export function toMidnightIST(d: Date): Date {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  const istMidnightAsUTC = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate()
  );
  return new Date(istMidnightAsUTC - IST_OFFSET_MS);
}
