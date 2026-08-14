import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyJwt, COOKIE_NAME } from "@/lib/auth/jwt";
import { RecordsClient } from "./RecordsClient";

/**
 * Super Admin → Records. Server-gated; the APIs enforce the role again (§12).
 */
export default async function RecordsPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) redirect("/login");

  const user = await verifyJwt(token);
  if (!user) redirect("/login");
  if (user.role !== "SUPER_ADMIN") redirect("/admin");

  // useSearchParams needs a Suspense boundary during prerender.
  return (
    <Suspense fallback={<div className="h-40" />}>
      <RecordsClient />
    </Suspense>
  );
}
