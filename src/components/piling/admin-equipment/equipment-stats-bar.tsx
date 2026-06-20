'use client';

import { cn } from '@/lib/utils';
import type { FleetSnapshot } from './fleet-types';

/**
 * KPI strip — same analytics as /monitoring, fed by the snapshot totals.
 * Real categories show numbers; telemetry-dependent ones (Офлайн) and the
 * not-yet-tracked "В ремонте" render as honest "нет данных" cells.
 */
export function EquipmentStatsBar({ totals }: { totals: FleetSnapshot['totals'] }) {
  const real: { label: string; value: number; tone?: string }[] = [
    { label: 'Всего', value: totals.totalEquipment },
    { label: 'В работе', value: totals.activeToday, tone: 'text-success' },
    { label: 'Простой', value: totals.idle, tone: 'text-warning' },
    { label: 'Операторы на смене', value: totals.operatorsOnShiftToday, tone: 'text-info' },
  ];
  const stubs = ['В ремонте', 'Офлайн'];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {real.map((k) => (
        <div key={k.label} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">{k.label}</div>
          <div className={cn('mt-1 text-2xl font-bold', k.tone ?? 'text-slate-900')}>{k.value}</div>
        </div>
      ))}
      {stubs.map((label) => (
        <div key={label} className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-4">
          <div className="text-xs text-slate-400">{label}</div>
          <div className="mt-1 text-2xl font-bold text-slate-300">—</div>
          <div className="text-3xs text-slate-400">нет данных</div>
        </div>
      ))}
    </div>
  );
}
