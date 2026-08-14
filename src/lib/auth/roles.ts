export function isAdminRole(role: string): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

/**
 * Super Admin — the application's highest privilege level (§1).
 *
 * Deliberately NOT satisfied by a normal ADMIN: this gates the control-panel
 * operations (system-wide activity view, undo/recovery) that ordinary admins
 * and executives must never reach. Always check this server-side; hiding a
 * button in the UI is presentation, never the security boundary.
 */
export function isSuperAdminRole(role: string): boolean {
  return role === "SUPER_ADMIN";
}
