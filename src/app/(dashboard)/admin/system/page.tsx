import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyJwt, COOKIE_NAME } from "@/lib/auth/jwt";
import { SystemOverviewClient } from "./SystemOverviewClient";

/**
 * Super Admin → System Overview.
 *
 * Gated on the server, the same way Admin Management is: a non-super-admin is
 * redirected before any of this renders. The APIs behind the page enforce the
 * role independently (§12) — this gate is convenience, not the boundary.
 */
export default async function SystemOverviewPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) redirect("/login");

  const user = await verifyJwt(token);
  if (!user) redirect("/login");
  if (user.role !== "SUPER_ADMIN") redirect("/admin");

  return <SystemOverviewClient />;
}
