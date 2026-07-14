'use client';

import type { FleetCard, FleetSnapshot } from './fleet-types';
import { getMaintenanceFlag } from './equipment-maintenance-flag';
import { PilingIcon, type PilingIconName } from '@/components/piling/icons';

const EQUIPMENT_KPI_ICONS: PilingIconName[] = ['equipment-rig', 'equipment-rig', 'downtime', 'repair', 'operator', 'maintenance-due'];

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
      {metrics.map((metric, index) => (
        <div key={metric.label} className="kpi-animated flex min-h-36 items-center gap-4 rounded-xl border p-4">
          <PilingIcon name={EQUIPMENT_KPI_ICONS[index]} size={74} decorative />
          <div className="min-w-0">
          <div className="text-xs text-white/80">{metric.label}</div>
          <div className="mt-1 text-2xl font-bold text-white">
            {metric.value}
          </div>
          </div>
        </div>
      ))}
    </div>
  );
}
