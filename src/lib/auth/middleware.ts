import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyJwt, COOKIE_NAME } from "./jwt";

export async function getAuthUser(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyJwt(token);
}

export function requireAuth(role?: "ADMIN" | "EXECUTIVE") {
  return async (request: NextRequest) => {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (role && user.role !== role) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return null; // null means OK
  };
}
