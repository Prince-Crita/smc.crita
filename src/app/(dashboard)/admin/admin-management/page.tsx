import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyJwt, COOKIE_NAME } from "@/lib/auth/jwt";
import { AdminManagementClient } from "./AdminManagementClient";

export default async function AdminManagementPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) redirect("/login");

  const user = await verifyJwt(token);
  if (!user || user.role !== "SUPER_ADMIN") redirect("/admin");

  return <AdminManagementClient />;
}
