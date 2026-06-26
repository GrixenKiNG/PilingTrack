'use client';

import { cn } from '@/lib/utils';
import type { OpsKpiItem } from './types';

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
        <div key={item.label} className="kpi-animated rounded-lg border p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-white/80">{item.label}</span>
            {item.icon && <item.icon className="h-4 w-4 text-white/90" />}
          </div>
          <p className="font-mono text-xl font-bold tabular-nums text-white">{item.value}</p>
          {item.detail && <p className="mt-0.5 text-3xs text-white/70">{item.detail}</p>}
        </div>
      ))}
    </div>
  );
}
