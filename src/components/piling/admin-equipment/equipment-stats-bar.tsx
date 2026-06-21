'use client';

import { cn } from '@/lib/utils';
import type { FleetCard, FleetSnapshot } from './fleet-types';
import { getMaintenanceFlag } from './equipment-maintenance-flag';

export function EquipmentStatsBar({
  totals,
  cards,
}: {
  totals: FleetSnapshot['totals'];
  cards: FleetCard[];
}) {
  const maintenanceRisks = cards.filter((card) => getMaintenanceFlag(card) !== null).length;
  const working = cards.filter((card) => card.equipmentStatus === 'working').length;
  const idle = cards.filter((card) => card.equipmentStatus === 'idle').length;
  const repair = cards.filter((card) => card.equipmentStatus === 'repair').length;

  const metrics: { label: string; value: number; tone?: string }[] = [
    { label: 'Всего', value: totals.totalEquipment },
    { label: 'В работе', value: working, tone: 'text-success' },
    { label: 'Простой', value: idle, tone: 'text-warning' },
    { label: 'В ремонте', value: repair, tone: 'text-info' },
    { label: 'Операторы на смене', value: totals.operatorsOnShiftToday, tone: 'text-info' },
    { label: 'ТО', value: maintenanceRisks, tone: maintenanceRisks > 0 ? 'text-orange-600' : 'text-success' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {metrics.map((metric) => (
        <div key={metric.label} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">{metric.label}</div>
          <div className={cn('mt-1 text-2xl font-bold', metric.tone ?? 'text-slate-900')}>
            {metric.value}
          </div>
        </div>
      ))}
    </div>
  );
}
