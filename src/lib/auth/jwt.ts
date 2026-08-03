import { SignJWT, jwtVerify } from "jose";

export interface JwtPayload {
  userId: string;
  email: string;
  name: string;
  role: "ADMIN" | "EXECUTIVE" | "SUPER_ADMIN";
  iat?: number;
  exp?: number;
}

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET || "fallback-secret-change-in-production-min-32-chars"
);

/**
 * Session lifetimes.
 *   SESSION_MAX_AGE_SECONDS  - normal login (unchanged: 8 hours)
 *   REMEMBER_MAX_AGE_SECONDS - "Remember Me" login (30 days)
 *
 * The JWT expiry and the cookie Max-Age are always set from the SAME value,
 * so a cookie can never outlive the token it carries (which is what made
 * users appear "logged in" and then get bounced to /login).
 */
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
export const REMEMBER_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export async function signJwt(
  payload: Omit<JwtPayload, "iat" | "exp">,
  maxAgeSeconds: number = SESSION_MAX_AGE_SECONDS
): Promise<string> {
  return new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(secret);
}

export async function verifyJwt(token: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    // A device-remember token is signed with the same secret but is NOT a
    // session credential. Reject it here so it can never be replayed as one
    // by dropping it into the session cookie. Written as a denylist (rather
    // than requiring type === "session") so session tokens already issued to
    // logged-in users stay valid across this deploy — nobody gets logged out.
    if ((payload as { type?: string }).type === REMEMBER_TOKEN_TYPE) return null;
    return payload as unknown as JwtPayload;
  } catch {
    return null;
  }
}

export const COOKIE_NAME = "smc_token";

// ─── Device "Remember Account" token ─────────────────────────────────────────
// A SECOND, independent cookie that records which accounts this DEVICE has
// chosen to remember. It is deliberately NOT a session: it grants nothing on
// its own, is never read by any API route other than /api/auth/continue, and
// carries no role — /api/auth/continue re-reads the user from the database
// (including isActive) before it will mint a real session.
//
// It survives logout on purpose: that is the whole point of the feature.
// Logout clears the SESSION cookie only, so the account stays offered on the
// login screen while the authenticated session is genuinely over.
//
// Stored: nothing but user IDs. No password, no session token, no role.
export const REMEMBER_COOKIE_NAME = "smc_remember";
export const REMEMBER_TOKEN_TYPE = "remember";
/** How long a device keeps offering a remembered account. */
export const REMEMBER_DEVICE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

interface RememberTokenPayload {
  type: typeof REMEMBER_TOKEN_TYPE;
  /** User IDs this device may re-authenticate with a tap. */
  users: string[];
  iat?: number;
  exp?: number;
}

/** Sign the device's remembered-account list. Empty list → null (clear it). */
export async function signRememberToken(userIds: string[]): Promise<string | null> {
  const unique = [...new Set(userIds.filter((id) => typeof id === "string" && id))];
  if (unique.length === 0) return null;
  return new SignJWT({ type: REMEMBER_TOKEN_TYPE, users: unique })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${REMEMBER_DEVICE_MAX_AGE_SECONDS}s`)
    .sign(secret);
}

/** Read the device's remembered user IDs. Returns [] when absent/expired/invalid. */
export async function readRememberedUserIds(token: string | undefined): Promise<string[]> {
  if (!token) return [];
  try {
    const { payload } = await jwtVerify(token, secret);
    const p = payload as unknown as RememberTokenPayload;
    // Must be a remember token — a stolen/mistaken session token must not be
    // usable here either. Both directions are checked.
    if (p.type !== REMEMBER_TOKEN_TYPE || !Array.isArray(p.users)) return [];
    return p.users.filter((id) => typeof id === "string" && id);
  } catch {
    return [];
  }
}
