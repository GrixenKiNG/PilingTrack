'use client';

/**
 * Вкладка «Обзор» паспорта установки + общий контракт GET /api/equipment/:id/details
 * (DetailsResponse) и справочники вкладок. Выделено из equipment-detail.tsx (аудит A-8).
 */

import { type ReactNode } from 'react';
import { KIND_LABELS } from '../equipment-form';
import { formatHours, type TimelineRow } from './equipment-detail-parts';
import { formatFixed } from '@/lib/format';
import type { EquipmentDTO, EquipmentKindDTO } from '@/lib/types';

export interface DetailsResponse {
  equipment: EquipmentDTO & Record<string, unknown>;
  crew: {
    id: string;
    name: string;
    operator: { id: string; name: string; email?: string };
    site: { id: string; name: string };
    assistants: Array<{ id: string; name: string }>;
  } | null;
  telematicsDevices: Array<{
    id: string;
    label: string;
    provider: string;
    model: string | null;
    status: string;
    lastSeenAt: string | null;
    imei: string | null;
    installedAt: string | null;
  }>;
  documents: Array<{
    id: string;
    type: string;
    title: string;
    issuedAt: string | null;
    expiresAt: string | null;
    notes: string;
  }>;
  stats30d: {
    reportCount: number;
    piles: number;
    pileMeters: number;
    drillingCount: number;
    drillingMeters: number;
    downtimeHours: number;
  };
  timeline: TimelineRow[];
}

export const KIND_BADGE_STYLE: Record<EquipmentKindDTO, string> = {
  PILE_DRIVER: 'bg-amber-100 text-amber-700 border-amber-200',
  DRILLING_RIG: 'bg-blue-100 text-blue-700 border-blue-200',
  VIBRO_HAMMER: 'bg-violet-100 text-violet-700 border-violet-200',
  HYBRID: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  OTHER: 'bg-slate-100 text-slate-600 border-slate-200',
};

export type TabKey =
  | 'overview' | 'work' | 'passport' | 'assignment' | 'maintenance'
  | 'documents' | 'photos' | 'history'
  | 'telemetry' | 'checklists' | 'errors';

export const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Обзор' },
  { key: 'work', label: 'Работа' },
  { key: 'passport', label: 'Паспорт' },
  { key: 'assignment', label: 'Закрепление' },
  { key: 'maintenance', label: 'ТО' },
  { key: 'documents', label: 'Документы' },
  { key: 'photos', label: 'Фото' },
  { key: 'history', label: 'История' },
];

export function OverviewHero({
  eq,
  crew,
}: {
  eq: EquipmentDTO & Record<string, unknown>;
  crew: DetailsResponse['crew'];
}) {
  const kind = ((eq.kind as EquipmentKindDTO) || 'OTHER');
  return (
    <div
      className="relative min-h-44 overflow-hidden rounded-lg border border-slate-200 bg-slate-900 bg-cover bg-center p-4 text-white"
      style={{ backgroundImage: "linear-gradient(90deg, rgba(15,23,42,.92), rgba(15,23,42,.48), rgba(15,23,42,.14)), url('/login-bg/bg-3.png')" }}
    >
      <div className="relative z-10 flex h-full min-h-36 flex-col justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-white/65">{KIND_LABELS[kind]}</div>
          <h2 className="mt-1 text-xl font-bold leading-tight">{eq.name}</h2>
          <div className="mt-1 text-sm text-white/80">{eq.model || 'Модель не указана'}</div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-2 text-xs">
          <div>
            <div className="text-white/55">Объект</div>
            <div className="truncate font-medium">{crew?.site.name || '—'}</div>
          </div>
          <div>
            <div className="text-white/55">Оператор</div>
            <div className="truncate font-medium">{crew?.operator.name || '—'}</div>
          </div>
          <div>
            <div className="text-white/55">Инв. номер</div>
            <div className="truncate font-mono font-medium">{eq.inventoryNumber || '—'}</div>
          </div>
          <div>
            <div className="text-white/55">Статус</div>
            {/* eq.isActive is the equipment lifecycle flag (in service / decommissioned),
                not whether it worked today — labelling it "В работе" overstated it. */}
            <div className="font-medium">{eq.isActive ? 'В эксплуатации' : 'Списана'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function OverviewTiles({
  eq,
  crew,
  stats,
  timeline,
  devicesCount,
}: {
  eq: EquipmentDTO & Record<string, unknown>;
  crew: DetailsResponse['crew'];
  stats: DetailsResponse['stats30d'];
  timeline: TimelineRow[];
  devicesCount: number;
}) {
  const kind = ((eq.kind as EquipmentKindDTO) || 'OTHER');
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <OverviewTile
        title="Основная информация"
        rows={[
          ['Тип техники', KIND_LABELS[kind]],
          ['Модель', eq.model || '—'],
          ['Инв. номер', eq.inventoryNumber || '—'],
          ['Объект', crew?.site.name || '—'],
          ['Оператор', crew?.operator.name || '—'],
          ['Бригада', crew?.name || '—'],
        ]}
      />
      <OverviewTile
        title="Текущее состояние"
        rows={[
          ['Статус', eq.isActive ? 'В эксплуатации' : 'Списана'],
          ['Моточасы', eq.engineHoursTotal != null ? `${formatFixed(Number(eq.engineHoursTotal), 0)} ч` : '—'],
          ['Телематика', devicesCount > 0 ? `${devicesCount} устройств` : 'не подключена'],
          ['Последний отчёт', timeline[0]?.date || '—'],
        ]}
      />
      <OverviewTile
        title="Производительность за 30 дней"
        rows={[
          ['Сваи', `${formatFixed(stats.piles, 0)} шт. / ${formatFixed(stats.pileMeters, 1)} м.п.`],
          ['Бурение', `${formatFixed(stats.drillingCount, 0)} шт. / ${formatFixed(stats.drillingMeters, 1)} м`],
          ['Простой', formatHours(stats.downtimeHours)],
          ['Отчёты', `${stats.reportCount}`],
        ]}
      />
      <OverviewTile
        title="ТО и обслуживание"
        rows={[
          ['Ближайшее ТО', eq.nextMaintenanceDate ? String(eq.nextMaintenanceDate).slice(0, 10) : '—'],
          ['Моточасы ТО', eq.nextMaintenanceAtHours != null ? `${formatFixed(Number(eq.nextMaintenanceAtHours), 0)} ч` : '—'],
          ['Замечания', timeline.some((row) => row.downtimeHours && row.downtimeHours > 0) ? 'есть простой' : 'нет'],
        ]}
      />
    </div>
  );
}

function OverviewTile({ title, rows }: { title: string; rows: Array<[string, ReactNode]> }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <dl className="space-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] gap-2 text-xs">
            <dt className="truncate text-slate-400">{label}</dt>
            <dd className="truncate text-right font-medium text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
