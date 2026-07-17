import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, formatDistanceToNow } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "—";
  return format(new Date(date), "dd MMM yyyy");
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return "—";
  return format(new Date(date), "dd MMM yyyy, hh:mm a");
}

export function formatTimeAgo(date: string | Date | null | undefined): string {
  if (!date) return "—";
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

export function getStatusColor(status: string): string {
  switch (status) {
    case "PENDING": return "text-amber-700 bg-amber-50 border-amber-200";
    case "OPEN": return "text-blue-700 bg-blue-50 border-blue-200";
    case "CLOSED": return "text-green-700 bg-green-50 border-green-200";
    case "IN_PROGRESS": return "text-blue-700 bg-blue-50 border-blue-200";
    case "COMPLETED": return "text-green-700 bg-green-50 border-green-200";
    case "PARTIALLY_COMPLETED": return "text-orange-700 bg-orange-50 border-orange-200";
    default: return "text-[#8896a9] bg-[#f1f4f9] border-[#e2e7f0]";
  }
}

export function getProgressColor(percentage: number): string {
  if (percentage === 100) return "bg-green-500";
  if (percentage >= 67)  return "bg-[#25488e]";
  if (percentage >= 34)  return "bg-amber-500";
  if (percentage > 0)    return "bg-[#800040]";
  return "bg-[#e2e7f0]";
}

export function getRatingColor(rating: string): string {
  switch (rating) {
    case "Excellent": return "text-green-600";
    case "Satisfactory": return "text-[#25488e]";
    case "Needs Improvement": return "text-amber-600";
    case "Unsatisfactory": return "text-red-600";
    default: return "text-[#8896a9]";
  }
}
