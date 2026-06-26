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
    case "PENDING": return "text-amber-400 bg-amber-400/10 border-amber-400/20";
    case "OPEN": return "text-blue-400 bg-blue-400/10 border-blue-400/20";
    case "CLOSED": return "text-emerald-400 bg-emerald-400/10 border-emerald-400/20";
    case "IN_PROGRESS": return "text-blue-400 bg-blue-400/10 border-blue-400/20";
    case "COMPLETED": return "text-emerald-400 bg-emerald-400/10 border-emerald-400/20";
    case "PARTIALLY_COMPLETED": return "text-orange-400 bg-orange-400/10 border-orange-400/20";
    default: return "text-slate-400 bg-slate-400/10 border-slate-400/20";
  }
}

export function getProgressColor(percentage: number): string {
  if (percentage >= 80) return "bg-emerald-500";
  if (percentage >= 50) return "bg-blue-500";
  if (percentage >= 25) return "bg-amber-500";
  return "bg-red-500";
}

export function getRatingColor(rating: string): string {
  switch (rating) {
    case "Excellent": return "text-emerald-400";
    case "Satisfactory": return "text-blue-400";
    case "Needs Improvement": return "text-amber-400";
    case "Unsatisfactory": return "text-red-400";
    default: return "text-slate-400";
  }
}
