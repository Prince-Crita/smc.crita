import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyJwt, COOKIE_NAME } from "@/lib/auth/jwt";
import { SystemHealthClient } from "./SystemHealthClient";

/**
 * Super Admin → Data Integrity. Server-gated; the API enforces the role
 * again (§12).
 */
export default async function SystemHealthPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) redirect("/login");

  const user = await verifyJwt(token);
  if (!user) redirect("/login");
  if (user.role !== "SUPER_ADMIN") redirect("/admin");

  return <SystemHealthClient />;
}
