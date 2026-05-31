'use client';

/**
 * EquipmentAnalytics — fleet analytics page (панель управления → after DLQ).
 *
 * MVP scope (Вариант 1): everything derives from report data + equipment
 * passport, except fuel which comes from the telematics `fuel_total` counter.
 * Reads GET /api/admin/equipment-analytics?dateFrom&dateTo[&siteId].
 *   - KPI tiles for the fleet
 *   - sortable per-rig table (click a row → the rig's page)
 *   - downtime Pareto
 *   - print / save via the browser
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Gauge, HardHat, Drill, Clock, Fuel, Wrench, Printer, ArrowUpDown,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { QueryErrorBanner } from '@/components/piling/async-ui';
import { KIND_LABELS } from '@/components/piling/admin-equipment/equipment-form';
import type { EquipmentKindDTO } from '@/lib/types';
import { appPageRoute } from '@/lib/routes';
import { cn } from '@/lib/utils';

interface EquipmentRow {
  equipmentId: string;
  name: string;
  model: string | null;
  kind: string;
  reportCount: number;
  activeDays: number;
  piles: number;
  pileMeters: number;
  drillingCount: number;
  drillingMeters: number;
  downtimeMinutes: number;
  fuelLiters: number;
  engineHoursTotal: number | null;
  nextMaintenanceAtHours: number | null;
  nextMaintenanceDate: string | null;
  maintenanceDue: boolean;
}

interface AnalyticsResult {
  dateFrom: string;
  dateTo: string;
  periodDays: number;
  fleet: {
    totalEquipment: number;
    activeCount: number;
    piles: number;
    pileMeters: number;
    drillingCount: number;
    drillingMeters: number;
    downtimeMinutes: number;
    fuelLiters: number;
    maintenanceDueCount: number;
  };
  equipment: EquipmentRow[];
  downtimePareto: Array<{ reasonId: string; reasonName: string; minutes: number; pct: number }>;
}

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function shiftYmd(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type SortKey = 'name' | 'piles' | 'drillingMeters' | 'reportCount' | 'activeDays' | 'downtimeMinutes' | 'fuelLiters';

export function EquipmentAnalytics() {
  const router = useRouter();
  const [from, setFrom] = useState(shiftYmd(-29));
  const [to, setTo] = useState(todayYmd());
  const [data, setData] = useState<AnalyticsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('piles');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const invalid = from > to;

  const load = useCallback(async () => {
    if (from > to) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ dateFrom: from, dateTo: to });
      const { authFetch } = await import('@/lib/api');
      const res = await authFetch(`/api/admin/equipment-analytics?${qs.toString()}`);
      if (!res.ok) { setError(`Сервер вернул ${res.status}`); return; }
      setData(await res.json());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  const sorted = useMemo(() => {
    if (!data) return [];
    const rows = [...data.equipment];
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === 'string' && typeof bv === 'string'
        ? av.localeCompare(bv)
        : (av as number) - (bv as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [data, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc'); }
  };

  const chip = 'rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50';

  return (
    <div className="space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <Gauge className="h-5 w-5 text-teal-600" /> Аналитика по установкам
          </h1>
          <p className="mt-1 text-sm text-slate-500">Выработка, утилизация, простои и обслуживание парка за период</p>
        </div>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="mr-1.5 h-4 w-4" /> Печать
        </Button>
      </div>

      {/* Period */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-2xs uppercase tracking-wide text-slate-400">С</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md border border-slate-200 bg-card px-2 py-1 text-sm" />
        </label>
        <label className="text-sm">
          <span className="block text-2xs uppercase tracking-wide text-slate-400">По</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-slate-200 bg-card px-2 py-1 text-sm" />
        </label>
        <div className="flex gap-1">
          <button type="button" onClick={() => { const t = todayYmd(); setFrom(t); setTo(t); }} className={chip}>Сегодня</button>
          <button type="button" onClick={() => { setTo(todayYmd()); setFrom(shiftYmd(-6)); }} className={chip}>7 дней</button>
          <button type="button" onClick={() => { setTo(todayYmd()); setFrom(shiftYmd(-29)); }} className={chip}>30 дней</button>
        </div>
      </div>

      {invalid && <p className="text-xs text-rose-500">Дата «С» позже даты «По».</p>}

      {error && !data ? (
        <QueryErrorBanner message={error} onRetry={() => void load()} retrying={loading} />
      ) : loading && !data ? (
        <Skeleton className="h-40 w-full" />
      ) : data ? (
        <>
          <KpiTiles fleet={data.fleet} />
          <FleetTable rows={sorted} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} periodDays={data.periodDays} onOpen={(id) => router.push(`${appPageRoute('admin-equipment')}/${id}`)} />
          <DowntimePareto rows={data.downtimePareto} />
        </>
      ) : null}
    </div>
  );
}

function KpiTiles({ fleet }: { fleet: AnalyticsResult['fleet'] }) {
  const tiles = [
    { label: 'Установки', icon: Gauge, value: `${fleet.activeCount} / ${fleet.totalEquipment}`, detail: 'в работе / всего' },
    { label: 'Сваи', icon: HardHat, value: `${fmt(fleet.piles)} шт`, detail: `${fmt(fleet.pileMeters)} м.п.` },
    { label: 'Бурение', icon: Drill, value: `${fmt(fleet.drillingCount)} шт`, detail: `${fmt(fleet.drillingMeters)} м.п.` },
    { label: 'Простой', icon: Clock, value: fmtHours(fleet.downtimeMinutes), detail: 'суммарно' },
    { label: 'Топливо', icon: Fuel, value: fleet.fuelLiters > 0 ? `${fmt(fleet.fuelLiters)} л` : '—', detail: fleet.fuelLiters > 0 ? 'расход за период' : 'нужна телеметрия' },
    { label: 'ТО', icon: Wrench, value: String(fleet.maintenanceDueCount), detail: 'скоро / просрочено', alert: fleet.maintenanceDueCount > 0 },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      {tiles.map((t) => (
        <Card key={t.label} className={cn('border shadow-sm', t.alert && 'border-amber-300 bg-amber-50/40')}>
          <CardContent className="p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">{t.label}</span>
              <t.icon className={cn('h-4 w-4', t.alert ? 'text-amber-600' : 'text-slate-400')} />
            </div>
            <p className="font-mono text-xl font-bold tabular-nums text-slate-900">{t.value}</p>
            <p className="mt-1 text-3xs text-slate-500">{t.detail}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

type FleetColumn = { k: SortKey; label: string; right?: boolean };

const FLEET_COLUMNS: FleetColumn[] = [
  { k: 'name', label: 'Установка' },
  { k: 'piles', label: 'Сваи', right: true },
  { k: 'drillingMeters', label: 'Бурение', right: true },
  { k: 'reportCount', label: 'Отчётов', right: true },
  { k: 'activeDays', label: 'Утилизация', right: true },
  { k: 'downtimeMinutes', label: 'Простой', right: true },
  { k: 'fuelLiters', label: 'Топливо', right: true },
];

// Module-level (not defined inside FleetTable's render) — the React Compiler
// flags components created during render (react-hooks/static-components).
function FleetTh({
  column, sortKey, sortDir, onSort,
}: {
  column: FleetColumn;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (k: SortKey) => void;
}) {
  const { k, label, right } = column;
  return (
    <th className={cn('px-3 py-2', right ? 'text-right' : 'text-left')}>
      <button type="button" onClick={() => onSort(k)} className={cn('inline-flex items-center gap-1 hover:text-slate-700', sortKey === k && 'text-slate-900')}>
        {label}
        <ArrowUpDown className="h-3 w-3 opacity-50" />
        {sortKey === k && <span className="text-3xs">{sortDir === 'asc' ? '↑' : '↓'}</span>}
      </button>
    </th>
  );
}

function FleetTable({
  rows, sortKey, sortDir, onSort, periodDays, onOpen,
}: {
  rows: EquipmentRow[];
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (k: SortKey) => void;
  periodDays: number;
  onOpen: (id: string) => void;
}) {
  if (rows.length === 0) {
    return <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">Нет установок за выбранный период.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            {FLEET_COLUMNS.map((column) => (
              <FleetTh key={column.k} column={column} sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            ))}
            <th className="px-3 py-2 text-right">ТО</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.equipmentId} className="cursor-pointer border-t hover:bg-slate-50/60" onClick={() => onOpen(r.equipmentId)}>
              <td className="px-3 py-2">
                <div className="font-medium text-slate-900">{r.name}</div>
                <div className="text-2xs text-slate-400">{KIND_LABELS[r.kind as EquipmentKindDTO] ?? r.kind}</div>
              </td>
              <td className="px-3 py-2 text-right font-mono">{fmt(r.piles)}<span className="text-2xs text-slate-400"> / {fmt(r.pileMeters)} м</span></td>
              <td className="px-3 py-2 text-right font-mono">{fmt(r.drillingCount)}<span className="text-2xs text-slate-400"> / {fmt(r.drillingMeters)} м</span></td>
              <td className="px-3 py-2 text-right font-mono">{r.reportCount}</td>
              <td className="px-3 py-2 text-right font-mono">
                {Math.round((r.activeDays / Math.max(periodDays, 1)) * 100)}%
                <span className="text-2xs text-slate-400"> ({r.activeDays}/{periodDays} дн)</span>
              </td>
              <td className="px-3 py-2 text-right font-mono">{fmtHours(r.downtimeMinutes)}</td>
              <td className="px-3 py-2 text-right font-mono">{r.fuelLiters > 0 ? `${fmt(r.fuelLiters)} л` : '—'}</td>
              <td className="px-3 py-2 text-right">
                {r.maintenanceDue
                  ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-2xs font-medium text-amber-700">скоро</span>
                  : <span className="text-2xs text-slate-300">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DowntimePareto({ rows }: { rows: AnalyticsResult['downtimePareto'] }) {
  if (rows.length === 0) {
    return (
      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Простои по причинам</h2>
        <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-500">Простоев за период нет.</p>
      </div>
    );
  }
  const max = Math.max(...rows.map((r) => r.minutes), 1);
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Простои по причинам</h2>
      <div className="space-y-2 rounded-lg border p-3">
        {rows.map((r) => (
          <div key={r.reasonId}>
            <div className="mb-0.5 flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate text-slate-700">{r.reasonName}</span>
              <span className="font-mono text-xs text-slate-500">{fmtHours(r.minutes)} · {r.pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded bg-slate-100">
              <div className="h-full rounded bg-amber-400" style={{ width: `${(r.minutes / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function fmt(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
}

function fmtHours(min: number): string {
  if (!min || min <= 0) return '0 ч';
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  if (h === 0) return `${m} мин`;
  if (m === 0) return `${h} ч`;
  return `${h} ч ${m} мин`;
}
