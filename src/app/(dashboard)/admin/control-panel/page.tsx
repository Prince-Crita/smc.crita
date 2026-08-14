import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyJwt, COOKIE_NAME } from "@/lib/auth/jwt";
import { ControlPanelClient } from "./ControlPanelClient";

/**
 * Super Admin → Control Panel.
 *
 * Server-gated like the other Super Admin pages. The operations API enforces
 * SUPER_ADMIN independently (§12), and the client still renders its own
 * "denied" state if it ever receives a 403.
 */
export default async function ControlPanelPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) redirect("/login");

  const user = await verifyJwt(token);
  if (!user) redirect("/login");
  if (user.role !== "SUPER_ADMIN") redirect("/admin");

  return (
    <Suspense fallback={<div className="h-40" />}>
      <ControlPanelClient />
    </Suspense>
  );
}
