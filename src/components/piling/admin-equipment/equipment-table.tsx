'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { FleetCard } from './fleet-types';
import { EQUIPMENT_STATUS_META, KIND_LABEL, REPORT_STATUS_META } from './equipment-status';
import { getMaintenanceFlag } from './equipment-maintenance-flag';

type SortKey = 'name' | 'equipmentStatus' | 'reportStatus' | 'engineHoursTotal';

const formatNum = (n: number | null | undefined, digits = 0) =>
  n == null ? '—' : n.toLocaleString('ru', { maximumFractionDigits: digits });

const downtimeDays = (hours: number | null | undefined) => {
  if (hours == null) return '—';
  if (hours <= 0) return '0';
  return String(Math.ceil(hours / 24));
};

export function EquipmentTable({
  cards,
  selectedId,
  onSelect,
}: {
  cards: FleetCard[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'name', asc: true });

  const sorted = [...cards].sort((a, b) => {
    const av = a[sort.key] ?? '';
    const bv = b[sort.key] ?? '';
    if (av < bv) return sort.asc ? -1 : 1;
    if (av > bv) return sort.asc ? 1 : -1;
    return 0;
  });

  const toggle = (key: SortKey) =>
    setSort((s) => ({ key, asc: s.key === key ? !s.asc : true }));

  const th = 'cursor-pointer select-none break-words px-1.5 py-2 text-left text-3xs font-semibold uppercase leading-tight text-slate-500';
  const staticTh = 'break-words px-1.5 py-2 text-left text-3xs font-semibold uppercase leading-tight text-slate-500';

  return (
    <div className="w-full overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table className="w-full table-auto border-collapse text-xs [&_td]:border-b [&_td]:border-r [&_td]:border-slate-200 [&_td]:align-top [&_td]:overflow-hidden [&_td]:px-1.5 [&_td]:py-2 [&_td:last-child]:border-r-0 [&_th]:border-b [&_th]:border-r [&_th]:border-slate-200 [&_th:last-child]:border-r-0">
        <thead className="bg-slate-50">
          <tr>
            <th className={th} onClick={() => toggle('name')}>Установка ↕</th>
            <th className={staticTh}>Объект</th>
            <th className={staticTh}>Бригада</th>
            <th className={staticTh}>Оператор</th>
            <th className={th} onClick={() => toggle('equipmentStatus')}>Статус техники ↕</th>
            <th className={th} onClick={() => toggle('reportStatus')}>Статус отчёта ↕</th>
            <th className="break-words px-1.5 py-2 text-right text-3xs font-semibold uppercase leading-tight text-slate-500">Сваи шт./м.п.</th>
            <th className="break-words px-1.5 py-2 text-right text-3xs font-semibold uppercase leading-tight text-slate-500">Бурение шт./м</th>
            <th className="break-words px-1.5 py-2 text-left text-3xs font-semibold uppercase leading-tight text-slate-500">Простой дн. / причина</th>
            <th className={th} onClick={() => toggle('engineHoursTotal')}>Моточасы ↕</th>
            <th className={staticTh}>ТО</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => {
            const equipmentStatus = EQUIPMENT_STATUS_META[c.equipmentStatus];
            const reportStatus = REPORT_STATUS_META[c.reportStatus];
            const flag = getMaintenanceFlag(c);
            const t = c.todayTotals;
            return (
              <tr
                key={c.id}
                onClick={() => onSelect(c.id)}
                className={cn(
                  'cursor-pointer transition-colors hover:bg-slate-50',
                  selectedId === c.id && 'bg-blue-50/60',
                )}
              >
                <td>
                  <div className="truncate font-medium text-slate-900" title={c.name}>{c.name}</div>
                  <div className="truncate text-xs text-slate-500">
                    {KIND_LABEL[c.kind]}{c.serialNumber ? ` · зав. ${c.serialNumber}` : ''}
                  </div>
                </td>
                <td className="break-words text-slate-600">{c.assignedSiteName ?? '—'}</td>
                <td className="break-words text-slate-600">{c.assignedCrewName ?? '—'}</td>
                <td className="break-words text-slate-600">{c.assignedOperatorName ?? '—'}</td>
                <td>
                  <span className={cn('inline-block max-w-full truncate rounded border px-1 py-0.5 text-3xs font-medium', equipmentStatus.badge)}>
                    {equipmentStatus.label}
                  </span>
                </td>
                <td>
                  <span className={cn('inline-block max-w-full truncate rounded border px-1 py-0.5 text-3xs font-medium', reportStatus.badge)}>
                    {reportStatus.label}
                  </span>
                </td>
                <td className="break-words text-right font-mono leading-tight text-slate-800">
                  {t ? `${formatNum(t.piles)} / ${formatNum(t.pileMeters, 1)}` : '—'}
                </td>
                <td className="break-words text-right font-mono leading-tight text-slate-800">
                  {t ? `${formatNum(t.drillingCount)} / ${formatNum(t.drillingMeters, 1)}` : '—'}
                </td>
                <td>
                  <div className="font-mono text-slate-800">{t ? downtimeDays(t.downtimeHours) : '—'}</div>
                  <div className="max-w-[180px] truncate text-xs text-slate-500" title={c.downtimeReason ?? ''}>
                    {c.downtimeReason ?? '—'}
                  </div>
                </td>
                <td className="truncate font-mono text-slate-700">{c.engineHoursTotal?.toLocaleString('ru') ?? '—'}</td>
                <td className="text-3xs">
                  {flag === 'overdue' ? (
                    <span className="text-destructive">Просрочено</span>
                  ) : flag === 'soon' ? (
                    <span className="text-warning">Скоро</span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
