import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyJwt, COOKIE_NAME } from "@/lib/auth/jwt";
import { isAdminRole } from "@/lib/auth/roles";

const PUBLIC_PATHS = ["/login", "/api/auth/login"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;

  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const payload = await verifyJwt(token);

  if (!payload) {
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete(COOKIE_NAME);
    return response;
  }

  // Role-based redirect from root
  if (pathname === "/") {
    if (isAdminRole(payload.role)) {
      return NextResponse.redirect(new URL("/admin", request.url));
    } else {
      return NextResponse.redirect(new URL("/executive", request.url));
    }
  }

  // Admin route protection
  if (pathname.startsWith("/admin") && !isAdminRole(payload.role)) {
    return NextResponse.redirect(new URL("/executive", request.url));
  }

  // Executive route protection
  if (pathname.startsWith("/executive") && payload.role !== "EXECUTIVE") {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\.png$).*)"],
};

export default proxy;
