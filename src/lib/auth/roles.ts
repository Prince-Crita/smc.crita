export function isAdminRole(role: string): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}
