'use client';

import { cn } from '@/lib/utils';
import type { OpsKpiItem, OpsTone } from './types';

const TONE_TEXT: Record<OpsTone, string> = {
  slate: 'text-slate-400',
  orange: 'text-orange-500',
  blue: 'text-blue-500',
  amber: 'text-amber-500',
  emerald: 'text-emerald-500',
  red: 'text-red-500',
};

// Static lg-column classes keyed by item count (Tailwind purge needs literals).
const LG_COLS: Record<number, string> = {
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
  6: 'lg:grid-cols-6',
};

/**
 * Top KPI strip. Responsive grid of stat tiles. Each module supplies its own
 * `items` (e.g. sites: active / behind plan / no rigs / piles done / metres done).
 */
export function OpsKpiBar({ items }: { items: OpsKpiItem[] }) {
  return (
    <div className={cn('grid grid-cols-2 gap-3', LG_COLS[Math.min(Math.max(items.length, 2), 6)])}>
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">{item.label}</span>
            {item.icon && <item.icon className={cn('h-4 w-4', TONE_TEXT[item.tone ?? 'slate'])} />}
          </div>
          <p className="font-mono text-xl font-bold tabular-nums text-slate-950">{item.value}</p>
          {item.detail && <p className="mt-0.5 text-3xs text-slate-400">{item.detail}</p>}
        </div>
      ))}
    </div>
  );
}
