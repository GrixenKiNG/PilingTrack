'use client';

import type { FleetCard, FleetSnapshot } from './fleet-types';
import { getMaintenanceFlag } from './equipment-maintenance-flag';
import { type PilingIconName } from '@/components/piling/icons';
import { KPI_GRID, KpiTile, kpiGridStyle } from '@/components/piling/kpi-tile';

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

  // Плитки повторяют раскладку OpsKpiBar (модуль «Объекты»): иконка в правом
  // верхнем углу, тот же размер (48×48) и та же высота плитки.
  return (
    <div className={KPI_GRID} style={kpiGridStyle(metrics.length)}>
      {metrics.map((metric, index) => (
        <KpiTile key={metric.label} icon={EQUIPMENT_KPI_ICONS[index]} label={metric.label} value={metric.value} />
      ))}
    </div>
  );
}
