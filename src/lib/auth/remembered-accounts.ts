"use client";

/**
 * Device-local list of remembered accounts — the DISPLAY half of the
 * "Remember Account" feature.
 *
 * WHAT IS STORED HERE (localStorage, readable by JavaScript):
 *   id, name, role, identifier (the email/mobile typed at login)
 *
 * WHAT IS NEVER STORED HERE:
 *   passwords, JWTs, session tokens, auth cookies — nothing that could be
 *   replayed to authenticate. This file holds labels for buttons, nothing more.
 *
 * The ACTUAL authority for "may this device tap Continue?" is the separate
 * httpOnly `smc_remember` cookie, which JavaScript cannot read or forge. So
 * tampering with localStorage gains an attacker nothing: adding a fake entry
 * just produces a card whose Continue is rejected by the server.
 *
 * localStorage (not sessionStorage) because the list must survive browser
 * close, app close and phone restart. It behaves identically in the Capacitor
 * Android WebView, which loads the same HTTPS origin.
 */

const STORAGE_KEY = "smc_remembered_accounts";
/** Defensive cap — a device realistically holds a handful of accounts. */
const MAX_ACCOUNTS = 10;

export interface RememberedAccount {
  id: string;
  name: string;
  role: string;
  /** The email or mobile number the user signs in with. */
  identifier: string;
}

function isValid(a: unknown): a is RememberedAccount {
  const x = a as RememberedAccount;
  return (
    !!x &&
    typeof x.id === "string" && !!x.id &&
    typeof x.name === "string" &&
    typeof x.role === "string" &&
    typeof x.identifier === "string"
  );
}

/** Read the device's remembered accounts. Safe on the server and in private mode. */
export function getRememberedAccounts(): RememberedAccount[] {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isValid).slice(0, MAX_ACCOUNTS) : EMPTY;
  } catch {
    // Corrupt JSON, or storage blocked (Safari private mode / locked-down
    // WebView). Degrade to "no remembered accounts" — the normal login form
    // still works exactly as before.
    return EMPTY;
  }
}

function write(accounts: RememberedAccount[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts.slice(0, MAX_ACCOUNTS)));
  } catch {
    /* storage unavailable — feature simply stays off on this device */
  } finally {
    emit();
  }
}

// ─── useSyncExternalStore plumbing ───────────────────────────────────────────
// localStorage is an external store, so React reads it through
// useSyncExternalStore rather than an effect: no cascading render on mount,
// correct SSR/hydration handling, and the list is on screen in the first
// client paint. `snapshot` is cached so getSnapshot returns a referentially
// stable value between real changes (required — otherwise it loops forever).

const EMPTY: RememberedAccount[] = [];
let snapshot: RememberedAccount[] | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  snapshot = null; // invalidate; recomputed lazily on next read
  listeners.forEach((l) => l());
}

/** Client snapshot for useSyncExternalStore. */
export function getAccountsSnapshot(): RememberedAccount[] {
  if (snapshot === null) snapshot = getRememberedAccounts();
  return snapshot;
}

/** Server snapshot — no localStorage during SSR, so nothing is remembered yet. */
export function getAccountsServerSnapshot(): RememberedAccount[] {
  return EMPTY;
}

/** Subscribe to changes, including edits made in another tab/window. */
export function subscribeToAccounts(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) emit();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Add or refresh one account, keeping every other remembered account.
 * Most-recently-used first, so the account you just signed in with leads.
 */
export function rememberAccount(account: RememberedAccount): void {
  if (!isValid(account)) return;
  const rest = getRememberedAccounts().filter((a) => a.id !== account.id);
  write([account, ...rest]);
}

/** Remove exactly one account; all others are untouched. */
export function forgetAccount(userId: string): RememberedAccount[] {
  const next = getRememberedAccounts().filter((a) => a.id !== userId);
  write(next);
  return next;
}

/** Human label for a role, matching the wording used elsewhere in the app. */
export function roleLabel(role: string): string {
  if (role === "SUPER_ADMIN") return "Super Admin";
  if (role === "ADMIN") return "Admin";
  if (role === "EXECUTIVE") return "Executive";
  return role;
}

/**
 * The identifier shown on an account card, chosen by ROLE rather than by
 * whatever the user happened to type at login:
 *   Admin / Super Admin → email
 *   Executive           → mobile number
 *
 * Falls back to the other value when the preferred one is missing (an
 * executive with no phone on record still gets a usable card).
 *
 * This doubles as the value prefilled into the login form if the device's
 * remember cookie has expired — POST /api/auth/login accepts either an email
 * or a mobile number as `identifier`, so both forms work there.
 */
export function displayIdentifier(
  role: string,
  email: string | null | undefined,
  phone: string | null | undefined
): string {
  const e = (email ?? "").trim();
  const p = (phone ?? "").trim();
  if (role === "EXECUTIVE") return p || e;
  return e || p;
}
