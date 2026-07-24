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

export async function signJwt(payload: Omit<JwtPayload, "iat" | "exp">): Promise<string> {
  return new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
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
