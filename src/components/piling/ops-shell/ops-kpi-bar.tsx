'use client';

import { KPI_GRID, KpiTile, kpiGridStyle } from '@/components/piling/kpi-tile';
import type { OpsKpiItem } from './types';

/**
 * Top KPI strip. Responsive grid of stat tiles. Each module supplies its own
 * `items` (e.g. sites: active / behind plan / no rigs / piles done / metres done).
 * Вид плитки — общий для всего приложения, см. KpiTile.
 */
export function OpsKpiBar({ items }: { items: OpsKpiItem[] }) {
  return (
    <div className={KPI_GRID} style={kpiGridStyle(items.length)}>
      {items.map((item) => (
        <KpiTile key={item.label} icon={item.icon ?? 'analytics'} label={item.label} value={item.value} detail={item.detail} />
      ))}
    </div>
  );
}
