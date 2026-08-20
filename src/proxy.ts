import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyJwt, COOKIE_NAME } from "@/lib/auth/jwt";
import { isAdminRole } from "@/lib/auth/roles";

// Reachable without a session. /api/auth/continue and /api/auth/forget serve
// the login screen's remembered-account cards, so by definition the caller is
// signed out. They authorise themselves from the httpOnly `smc_remember`
// cookie instead (see those routes).
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/continue", "/api/auth/forget"];

// Development-only diagnostics. /api/dev/* answers 404 when NODE_ENV is
// "production", so this can never be reached on a deployed server. It is
// reachable without a session on purpose: you need it most when the database
// is misconfigured and logging in is exactly what does not work.
const DEV_ONLY_PATHS = ["/api/dev/"];


// Build a redirect target from the INCOMING url so the app's mount point is
// preserved. request.nextUrl.clone() keeps nextUrl.basePath, and assigning
// .pathname sets the path *after* it — so the same code emits "/login" when
// the app is served from the domain root, and
// "/client-trial/smc-task-management/login" when it is served from a sub-path
// behind a reverse proxy. `new URL("/login", request.url)` (the previous form)
// always resolves against the ORIGIN, which drops the prefix and sends the
// browser outside the proxied location.
function redirectTo(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  return NextResponse.redirect(url);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (process.env.NODE_ENV !== "production" && DEV_ONLY_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;

  if (!token) {
    return redirectTo(request, "/login");
  }

  const payload = await verifyJwt(token);

  if (!payload) {
    const response = redirectTo(request, "/login");
    response.cookies.delete(COOKIE_NAME);
    return response;
  }

  // Role-based redirect from root
  if (pathname === "/") {
    if (isAdminRole(payload.role)) {
      return redirectTo(request, "/admin");
    } else {
      return redirectTo(request, "/executive");
    }
  }

  // Admin route protection
  if (pathname.startsWith("/admin") && !isAdminRole(payload.role)) {
    return redirectTo(request, "/executive");
  }

  // Executive route protection
  if (pathname.startsWith("/executive") && payload.role !== "EXECUTIVE") {
    return redirectTo(request, "/admin");
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\.png$).*)"],
};

export default proxy;
