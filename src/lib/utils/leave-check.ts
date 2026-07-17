import { prisma } from "@/lib/db/prisma";

/**
 * Checks if an executive has an approved leave on a given date.
 * Returns the LeaveRequest if found, null otherwise.
 */
export async function getApprovedLeave(executiveId: string, date: Date) {
  // Normalise to midnight UTC (same as Attendance/Leave storage convention)
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return prisma.leaveRequest.findFirst({
    where: {
      executiveId,
      date: d,
      status: "APPROVED",
    },
  });
}

/**
 * Given a date (ISO string or Date), returns the midnight-UTC version.
 */
export function toMidnightUTC(d: Date | string): Date {
  const dt = typeof d === "string" ? new Date(d) : d;
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
}
