'use client';

import type { ReactNode } from 'react';
import { Filter } from '@/components/piling/icons/unified-icons';
import { cn } from '@/lib/utils';
import type { OpsQuickFilter } from './types';

/**
 * Filter container: a row of quick-filter pills plus an optional slot on the
 * right for date pickers / dropdowns, and an optional footer line (e.g. counts).
 * The dropdown filters themselves stay module-specific — pass them via `extra`.
 */
export function OpsFilterBar<K extends string>({
  quickFilters,
  active,
  onSelect,
  extra,
  footer,
}: {
  quickFilters: OpsQuickFilter<K>[];
  active: K;
  onSelect: (key: K) => void;
  extra?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="hidden h-4 w-4 text-slate-400 sm:block" />
        {quickFilters.map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={() => onSelect(filter.key)}
            className={cn(
              'min-h-9 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
              active === filter.key
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white',
            )}
          >
            {filter.label}
          </button>
        ))}
        {extra && <div className="ml-auto flex flex-wrap items-center gap-2">{extra}</div>}
      </div>
      {footer && <div className="text-xs text-slate-500">{footer}</div>}
    </div>
  );
}
