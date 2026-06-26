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
      {/* Icon circle */}
      <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700 mb-5 shadow-inner">
        <Icon className="w-8 h-8 text-slate-400" strokeWidth={1.5} />
      </div>

      {/* Title */}
      <h3 className="text-base font-semibold text-white mb-2">{title}</h3>

      {/* Description */}
      <p className="text-sm text-slate-400 max-w-xs leading-relaxed mb-6">
        {description}
      </p>

      {/* Optional action */}
      {action && (
        <button
          onClick={action.onClick}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-4 py-2 text-sm font-medium transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
