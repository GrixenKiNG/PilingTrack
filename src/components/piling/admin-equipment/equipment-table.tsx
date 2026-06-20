'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { FleetCard } from './fleet-types';
import { STATUS_META, KIND_LABEL } from './equipment-status';
import { getMaintenanceFlag } from './equipment-maintenance-flag';

type SortKey = 'name' | 'status' | 'engineHoursTotal';

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

  const th = 'cursor-pointer select-none px-3 py-2.5 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500';

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <th className={th} onClick={() => toggle('name')}>Установка ↕</th>
            <th className="px-3 py-2.5 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">Тип</th>
            <th className="px-3 py-2.5 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">Объект</th>
            <th className={th} onClick={() => toggle('status')}>Статус ↕</th>
            <th className="px-3 py-2.5 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">Оператор</th>
            <th className="px-3 py-2.5 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">Бригада</th>
            <th className={th} onClick={() => toggle('engineHoursTotal')}>Моточасы ↕</th>
            <th className="px-3 py-2.5 text-left text-2xs font-semibold uppercase tracking-wide text-slate-500">ТО</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => {
            const st = STATUS_META[c.status];
            const flag = getMaintenanceFlag(c);
            return (
              <tr
                key={c.id}
                onClick={() => onSelect(c.id)}
                className={cn(
                  'cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50',
                  selectedId === c.id && 'bg-blue-50/60',
                )}
              >
                <td className="px-3 py-2.5 font-medium text-slate-900">{c.name}</td>
                <td className="px-3 py-2.5 text-slate-500">{KIND_LABEL[c.kind]}</td>
                <td className="px-3 py-2.5 text-slate-600">{c.assignedSiteName ?? '—'}</td>
                <td className="px-3 py-2.5">
                  <span className={cn('rounded-full border px-2 py-0.5 text-xs font-medium', st.badge)}>{st.label}</span>
                </td>
                <td className="px-3 py-2.5 text-slate-600">{c.assignedOperatorName ?? '—'}</td>
                <td className="px-3 py-2.5 text-slate-600">{c.assignedCrewName ?? '—'}</td>
                <td className="px-3 py-2.5 font-mono text-slate-700">{c.engineHoursTotal?.toLocaleString('ru') ?? '—'}</td>
                <td className="px-3 py-2.5 text-xs">
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
