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
    return payload as unknown as JwtPayload;
  } catch {
    return null;
  }
}

export const COOKIE_NAME = "smc_token";
