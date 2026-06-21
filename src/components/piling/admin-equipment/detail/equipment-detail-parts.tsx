'use client';

/**
 * Презентационные под-компоненты страницы паспорта установки.
 * Вынесены из equipment-detail.tsx, чтобы держать основной файл < 500 строк.
 * Чистый перенос: разметка и поведение не менялись.
 */

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ChevronRight, ChevronDown, type LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatFixed, formatHours, formatRelative, formatRuDate } from '@/lib/format';
import type { EquipmentDTO } from '@/lib/types';

// --------------------------------------------------------------------------
// Generic layout pieces
// --------------------------------------------------------------------------

export function Section({
  icon: Icon, title, children, collapsible = false, defaultOpen = true,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="mb-3 flex w-full items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700"
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <Icon className="w-4 h-4" /> {title}
          </button>
        ) : (
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            <Icon className="w-4 h-4" /> {title}
          </h2>
        )}
        {(!collapsible || open) && children}
      </CardContent>
    </Card>
  );
}

export function KV({ label, value, full = false }: { label: string; value: React.ReactNode; full?: boolean }) {
  return (
    <div className={cn(full && 'sm:col-span-3')}>
      <dt className="text-2xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{value}</dd>
    </div>
  );
}

export function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-2xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 font-mono text-lg tabular-nums">{value}</div>
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">{message}</p>;
}

export function BackLink() {
  return (
    <Link
      href="/admin/equipment"
      className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
    >
      <ArrowLeft className="w-3 h-3" /> К списку установок
    </Link>
  );
}

function ShiftBadge({ type }: { type: string }) {
  if (type === 'NIGHT') {
    return <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-indigo-700">Ночь</span>;
  }
  return <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">День</span>;
}

export function TelematicsStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE:     'bg-emerald-100 text-emerald-700',
    PROVISIONED: 'bg-slate-100 text-slate-600',
    DEGRADED:   'bg-amber-100 text-amber-700',
    OFFLINE:    'bg-rose-100 text-rose-700',
    ARCHIVED:   'bg-slate-100 text-slate-400',
  };
  return <span className={cn('rounded px-1.5 py-0.5', map[status] || 'bg-slate-100 text-slate-600')}>{status}</span>;
}

// --------------------------------------------------------------------------
// Work history
// --------------------------------------------------------------------------

export interface TimelineRow {
  reportId: string;
  date: string;
  shiftType: string;
  status: string;
  siteName: string | null;
  operatorName: string | null;
  updatedAt: string;
  piles: number | null;
  drillingMeters: number | null;
  downtimeHours: number | null;
}

// Collapsible work history: shows only the latest report by default; the
// chevron on the latest row (and the footer toggle) expands to the full
// history inside a scrollable area.
export function HistoryTable({ rows }: { rows: TimelineRow[] }) {
  const [open, setOpen] = useState(false);
  const hasMore = rows.length > 1;
  const visible = open ? rows : rows.slice(0, 1);

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className={cn(open && 'max-h-64 overflow-y-auto')}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="w-8 px-2 py-2" />
              <th className="px-3 py-2 text-left">Дата</th>
              <th className="px-3 py-2 text-left">Смена</th>
              <th className="px-3 py-2 text-left">Объект</th>
              <th className="px-3 py-2 text-left">Оператор</th>
              <th className="px-3 py-2 text-right">Свай</th>
              <th className="px-3 py-2 text-right">Бурение</th>
              <th className="px-3 py-2 text-right">Простой</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr key={row.reportId} className="border-t hover:bg-slate-50/50">
                <td className="px-2 py-2 align-middle">
                  {i === 0 && hasMore && (
                    <button
                      type="button"
                      onClick={() => setOpen((o) => !o)}
                      aria-expanded={open}
                      aria-label={open ? 'Свернуть историю' : 'Развернуть историю'}
                      className="flex items-center justify-center rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                      {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  )}
                </td>
                <td className="px-3 py-2 font-mono">{formatRuDate(row.date)}</td>
                <td className="px-3 py-2 text-xs">
                  <ShiftBadge type={row.shiftType} />
                </td>
                <td className="px-3 py-2">{row.siteName ?? '—'}</td>
                <td className="px-3 py-2">{row.operatorName ?? '—'}</td>
                <td className="px-3 py-2 text-right font-mono">{row.piles ?? '—'}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {row.drillingMeters != null ? formatFixed(row.drillingMeters, 1) : '—'}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {row.downtimeHours != null ? formatHours(row.downtimeHours) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-center gap-1 border-t bg-slate-50/50 py-1.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          {open ? 'Свернуть' : `Показать всю историю (${rows.length})`}
        </button>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Maintenance summary
// --------------------------------------------------------------------------

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function MaintenanceBlock({ eq }: { eq: EquipmentDTO & Record<string, unknown> }) {
  const hoursTotal = numOrNull(eq.engineHoursTotal);
  const nextHours = numOrNull(eq.nextMaintenanceAtHours);
  const nextDateStr = eq.nextMaintenanceDate ? String(eq.nextMaintenanceDate) : null;

  const hasHours = hoursTotal != null && nextHours != null;
  const hasDate = !!nextDateStr;
  if (!hasHours && !hasDate) {
    return <EmptyState message="Данные ТО не заполнены. Откройте «Редактировать» и укажите наработку и следующее ТО." />;
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null invariant established earlier in this function
  const remainingHours = hasHours ? nextHours! - hoursTotal! : null;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null invariant established earlier in this function
  const hoursPct = hasHours && nextHours! > 0 ? Math.min(100, Math.max(0, (hoursTotal! / nextHours!) * 100)) : 0;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null invariant established earlier in this function
  const daysLeft = hasDate ? Math.round((new Date(nextDateStr!).getTime() - Date.now()) / 86_400_000) : null;

  const hoursStatus = remainingHours == null ? 'ok' : remainingHours <= 0 ? 'alarm' : remainingHours <= 50 ? 'warn' : 'ok';
  const dateStatus = daysLeft == null ? 'ok' : daysLeft < 0 ? 'alarm' : daysLeft <= 14 ? 'warn' : 'ok';

  const barColor = (st: string) => (st === 'alarm' ? 'bg-rose-500' : st === 'warn' ? 'bg-amber-500' : 'bg-emerald-500');
  const txtColor = (st: string) => (st === 'alarm' ? 'text-rose-600' : st === 'warn' ? 'text-amber-600' : 'text-slate-700');

  return (
    <div className="space-y-4">
      {hasHours && (
        <div>
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="text-slate-600">Моточасы до ТО</span>
            <span className={cn('font-mono text-xs', txtColor(hoursStatus))}>
              {(remainingHours ?? 0) > 0
                ? `осталось ${formatFixed(remainingHours ?? 0, 0)} ч`
                : `просрочено на ${formatFixed(-(remainingHours ?? 0), 0)} ч`}
              <span className="text-slate-400"> · {formatFixed(hoursTotal ?? 0, 0)} / {formatFixed(nextHours ?? 0, 0)} ч</span>
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded bg-slate-100">
            <div className={cn('h-full rounded', barColor(hoursStatus))} style={{ width: `${hoursPct}%` }} />
          </div>
        </div>
      )}

      {hasDate && (
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="text-slate-600">Следующее ТО по дате</span>
          <span className={cn('font-mono text-xs', txtColor(dateStatus))}>
            {formatRuDate((nextDateStr ?? '').slice(0, 10))}
            {daysLeft != null && (
              <span> · {daysLeft < 0 ? `просрочено на ${-daysLeft} дн` : daysLeft === 0 ? 'сегодня' : `через ${daysLeft} дн`}</span>
            )}
          </span>
        </div>
      )}

      <p className="text-3xs text-slate-400">Прогноз по темпу наработки появится с подключением телеметрии моточасов.</p>
    </div>
  );
}

// --------------------------------------------------------------------------
// Passport grid — only shows filled fields
// --------------------------------------------------------------------------

export function PassportGrid({ eq }: { eq: EquipmentDTO & Record<string, unknown> }) {
  const rows: Array<{ label: string; value: React.ReactNode }> = [];

  const push = (label: string, value: unknown) => {
    if (value === null || value === undefined || value === '') return;
    rows.push({ label, value: String(value) });
  };
  const pushNum = (label: string, value: unknown, suffix: string) => {
    if (value === null || value === undefined || value === '') return;
    rows.push({ label, value: `${formatFixed(Number(value), 1)} ${suffix}` });
  };
  const pushInt = (label: string, value: unknown, suffix: string) => {
    if (value === null || value === undefined) return;
    rows.push({ label, value: `${value} ${suffix}` });
  };
  const pushDate = (label: string, value: unknown) => {
    if (!value) return;
    const iso = typeof value === 'string' ? value : String(value);
    rows.push({ label, value: formatRuDate(iso.slice(0, 10)) });
  };

  // A
  push('Серийный номер', eq.serialNumber);
  push('VIN', eq.vin);
  push('Базовая машина', eq.baseVehicle);
  // B
  pushNum('Вес', eq.weightTons, 'т');
  pushNum('Вес с оборудованием', eq.weightWithEquipmentTons, 'т');
  pushInt('Высота', eq.heightMm, 'мм');
  pushInt('Длина', eq.lengthMm, 'мм');
  pushInt('Ширина', eq.widthMm, 'мм');
  push('Марка двигателя', eq.engineBrand);
  push('Номер двигателя', eq.engineSerialNumber);
  pushInt('Мощность двигателя', eq.enginePower, 'кВт');
  pushNum('Макс. длина сваи', eq.maxPileLength, 'м');
  pushNum('Макс. глубина бурения', eq.maxDrillingDepth, 'м');
  push('Тип молота', eq.hammerType);
  push('Серийник молота', eq.hammerSerialNumber);
  pushNum('Энергия удара', eq.hammerEnergyKj, 'кДж');
  // C
  pushDate('Дата покупки', eq.purchaseDate);
  if (eq.purchasePrice) {
    rows.push({ label: 'Стоимость покупки', value: `${formatFixed(Number(eq.purchasePrice), 2)} ₽` });
  }
  pushInt('Наработка моточасов', eq.engineHoursTotal, 'ч');
  pushInt('След. ТО по моточасам', eq.nextMaintenanceAtHours, 'ч');
  pushDate('След. ТО по дате', eq.nextMaintenanceDate);
  push('Место базирования', eq.homeBaseLocation);

  if (rows.length === 0) {
    return <EmptyState message="Паспортные данные не заполнены. Открой «Редактировать» и заполни шаблон." />;
  }

  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3 text-sm">
      {rows.map((r, i) => (
        <div key={i}>
          <dt className="text-2xs uppercase tracking-wide text-slate-400">{r.label}</dt>
          <dd className="mt-0.5 text-slate-900">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// --------------------------------------------------------------------------
// Formatters
// --------------------------------------------------------------------------

// formatHours / formatRelative are canonical in @/lib/format; re-exported here
// so the detail screen keeps importing them from one place.
export { formatHours, formatRelative };
