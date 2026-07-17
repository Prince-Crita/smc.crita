'use client';

import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils/utils';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-16 px-6 text-center',
        className
      )}
    >
      {/* Icon square */}
      <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-[#f1f4f9] border border-[#e2e7f0] mb-5">
        <Icon className="w-8 h-8 text-[#c8d2e0]" strokeWidth={1.5} />
      </div>

      {/* Title */}
      <h3 className="text-base font-semibold text-[#0f1829] mb-2">{title}</h3>

      {/* Description */}
      <p className="text-sm text-[#8896a9] max-w-xs leading-relaxed mb-6">
        {description}
      </p>

      {/* Optional action */}
      {action && (
        <button
          onClick={action.onClick}
          className="bg-[#25488e] hover:bg-[#1e3a72] text-white rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors press-effect shadow-sm"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
