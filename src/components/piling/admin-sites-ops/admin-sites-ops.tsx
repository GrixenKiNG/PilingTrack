'use client';

import { useMemo, useState } from 'react';
import { MapPin, HardHat, Drill, Users, AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { QueryErrorBanner } from '@/components/piling/async-ui';
import { formatNumber, pluralizeRu } from '@/lib/format';
import {
  OpsPage,
  OpsHeader,
  OpsKpiBar,
  OpsFilterBar,
  OpsTable,
  OpsTableEmpty,
  OpsDetailPanel,
  OpsDetailEmpty,
  OpsFact,
  OpsHistoryList,
  OpsRiskBadge,
  resolveRisk,
  useEntityHistory,
  type OpsColumn,
  type OpsQuickFilter,
  type OpsKpiItem,
} from '@/components/piling/ops-shell';
import { useSitesOpsData, type SiteOpsRow } from './use-sites-ops-data';

type QuickKey = 'all' | 'behind' | 'noCrew' | 'noReports' | 'downtime';

const QUICK_FILTERS: OpsQuickFilter<QuickKey>[] = [
  { key: 'all', label: 'Все' },
  { key: 'behind', label: 'Отставание' },
  { key: 'noCrew', label: 'Без бригад' },
  { key: 'noReports', label: 'Без отчётов' },
  { key: 'downtime', label: 'С простоем' },
];

// Risk rules are hardcoded per module (no rules engine — see module-vs-dictionary).
function siteRisk(row: SiteOpsRow) {
  return resolveRisk(
    [
      [row.totalReports === 0, 'critical', 'Нет отчётов'],
      [row.plannedPiles > 0 && row.pileProgress < 60, 'warn', 'Отставание'],
      [row.crewCount === 0, 'warn', 'Без бригад'],
    ],
    'В графике',
  );
}

function pct(value: number): string {
  return `${Math.round(Math.max(0, Math.min(100, value)))}%`;
}

export function AdminSitesOps() {
  const { rows, loading, error, reload } = useSitesOpsData();
  const [quick, setQuick] = useState<QuickKey>('all');
  const [activeId, setActiveId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (quick === 'behind') return r.plannedPiles > 0 && r.pileProgress < 60;
      if (quick === 'noCrew') return r.crewCount === 0;
      if (quick === 'noReports') return r.totalReports === 0;
      if (quick === 'downtime') return r.totalDowntime > 0;
      return true;
    });
  }, [rows, quick]);

  const active = useMemo(
    () => filtered.find((r) => r.siteId === activeId) ?? filtered[0] ?? null,
    [filtered, activeId],
  );

  const kpis: OpsKpiItem[] = useMemo(() => {
    const piles = rows.reduce((s, r) => s + r.actualPiles, 0);
    const meters = rows.reduce((s, r) => s + r.actualPileMeters, 0);
    const behind = rows.filter((r) => r.plannedPiles > 0 && r.pileProgress < 60).length;
    const noCrew = rows.filter((r) => r.crewCount === 0).length;
    return [
      { label: 'Объекты', value: String(rows.length), detail: 'активные', icon: MapPin, tone: 'slate' },
      { label: 'Отставание', value: String(behind), detail: '< 60% плана', icon: AlertTriangle, tone: behind > 0 ? 'amber' : 'slate' },
      { label: 'Без бригад', value: String(noCrew), detail: 'не назначены', icon: Users, tone: noCrew > 0 ? 'red' : 'slate' },
      { label: 'Сваи факт', value: formatNumber(piles), detail: 'шт. суммарно', icon: HardHat, tone: 'orange' },
      { label: 'Метры факт', value: formatNumber(meters), detail: 'м.п. суммарно', icon: Drill, tone: 'blue' },
    ];
  }, [rows]);

  const columns: OpsColumn<SiteOpsRow>[] = [
    {
      key: 'name',
      header: 'Объект',
      width: 'minmax(180px,1.6fr)',
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-slate-950">{r.siteName}</div>
          <div className="mt-0.5 truncate text-2xs text-slate-400">
            {r.crewCount} {pluralizeRu(r.crewCount, ['бригада', 'бригады', 'бригад'])}
            {r.rigNames.length > 0 ? ` · ${r.rigNames.join(', ')}` : ''}
          </div>
        </div>
      ),
    },
    {
      key: 'piles',
      header: 'Сваи план/факт',
      width: 'minmax(120px,1fr)',
      cell: (r) => (
        <div className="min-w-0">
          <span className="font-mono text-sm font-semibold tabular-nums text-slate-900">
            {formatNumber(r.actualPiles)}
          </span>
          <span className="text-2xs text-slate-400"> / {formatNumber(r.plannedPiles)}</span>
          <ProgressBar pct={r.pileProgress} tone="orange" />
        </div>
      ),
    },
    {
      key: 'progress',
      header: 'Прогресс',
      width: '88px',
      align: 'right',
      cell: (r) => (
        <span className="font-mono text-sm font-semibold tabular-nums text-slate-700">{pct(r.pileProgress)}</span>
      ),
    },
    {
      key: 'reports',
      header: 'Отчёты',
      width: '80px',
      align: 'right',
      cell: (r) => <span className="font-mono text-sm tabular-nums text-slate-700">{r.totalReports}</span>,
    },
    {
      key: 'downtime',
      header: 'Простой',
      width: '88px',
      align: 'right',
      cell: (r) => (
        <span className="font-mono text-sm tabular-nums text-slate-700">
          {r.totalDowntime > 0 ? `${formatNumber(r.totalDowntime)} ч` : '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Статус',
      width: '116px',
      cell: (r) => {
        const risk = siteRisk(r);
        return <OpsRiskBadge level={risk.level} label={risk.label} />;
      },
    },
  ];

  if (loading) {
    return (
      <div className="space-y-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-28 w-full" />
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }

  const header = (
    <OpsHeader
      icon={MapPin}
      title="Объекты"
      countLabel={`${filtered.length} ${pluralizeRu(filtered.length, ['объект', 'объекта', 'объектов'])}`}
      subtitle="План/факт стройки: прогресс, бригады, простои, отчёты"
      actions={
        <Button variant="outline" onClick={reload} className="h-10 border-slate-300 bg-white text-slate-700">
          <RotateCcw className="mr-1.5 h-4 w-4" />
          Обновить
        </Button>
      }
    />
  );

  if (error) {
    return (
      <div className="min-h-full bg-slate-50/60 p-4 lg:p-6">
        <div className="space-y-4">
          {header}
          <QueryErrorBanner title="Не удалось загрузить объекты" message={error} onRetry={reload} />
        </div>
      </div>
    );
  }

  return (
    <OpsPage
      header={header}
      aside={active ? <SiteDetail row={active} /> : <OpsDetailEmpty message="Выберите объект, чтобы увидеть план/факт и историю." />}
    >
      <OpsKpiBar items={kpis} />
      <OpsFilterBar
        quickFilters={QUICK_FILTERS}
        active={quick}
        onSelect={setQuick}
        footer={`Показано ${filtered.length} из ${rows.length}`}
      />
      <OpsTable
        columns={columns}
        rows={filtered}
        getRowId={(r) => r.siteId}
        activeId={active?.siteId ?? null}
        onRowSelect={(r) => setActiveId(r.siteId)}
        empty={<OpsTableEmpty icon={MapPin} title="Объекты не найдены" hint="Измените быстрый фильтр." />}
      />
    </OpsPage>
  );
}

function SiteDetail({ row }: { row: SiteOpsRow }) {
  const risk = siteRisk(row);
  const history = useEntityHistory('sites', row.siteId);
  return (
    <OpsDetailPanel
      title={row.siteName}
      subtitle={`Объект · ${row.totalReports} ${pluralizeRu(row.totalReports, ['отчёт', 'отчёта', 'отчётов'])}`}
      status={<OpsRiskBadge level={risk.level} label={risk.label} />}
    >
      <div className="grid grid-cols-2 divide-x rounded-md border border-slate-200 bg-slate-50">
        <OpsFact label="Сваи план" value={`${formatNumber(row.plannedPiles)} шт.`} sub={`${formatNumber(row.plannedPileMeters)} м.п.`} />
        <OpsFact label="Сваи факт" value={`${formatNumber(row.actualPiles)} шт.`} sub={`${formatNumber(row.actualPileMeters)} м.п.`} />
      </div>
      <div className="grid grid-cols-3 divide-x rounded-md border border-slate-200">
        <OpsFact label="Бурение план" value={formatNumber(row.plannedDrilling)} sub="м" />
        <OpsFact label="Бурение факт" value={formatNumber(row.actualDrilling)} sub="м" />
        <OpsFact label="Простой" value={row.totalDowntime > 0 ? `${formatNumber(row.totalDowntime)} ч` : '—'} />
      </div>

      <div className="rounded-md border border-slate-200 p-2.5">
        <h3 className="mb-1.5 text-xs font-semibold text-slate-900">Прогресс</h3>
        <LabeledProgress label="Сваи" pct={row.pileProgress} tone="orange" />
        <LabeledProgress label="Бурение" pct={row.drillingProgress} tone="blue" />
      </div>

      <div className="rounded-md border border-slate-200 p-2.5">
        <h3 className="mb-1 text-xs font-semibold text-slate-900">Бригады и установки</h3>
        <p className="text-2xs text-slate-600">
          {row.crewCount > 0
            ? `${row.crewCount} ${pluralizeRu(row.crewCount, ['бригада', 'бригады', 'бригад'])}${row.rigNames.length ? ` · ${row.rigNames.join(', ')}` : ''}`
            : 'Бригады не назначены'}
        </p>
      </div>

      {/* Live history from GET /api/audit (scope 'sites'). Populates once site
          write-paths emit events; renders "Событий пока нет" until then. */}
      <OpsHistoryList entries={history.entries} loading={history.loading} error={history.error} title="История изменений" />
    </OpsDetailPanel>
  );
}

function ProgressBar({ pct: value, tone }: { pct: number; tone: 'orange' | 'blue' }) {
  return (
    <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100">
      <div
        className={tone === 'orange' ? 'h-full rounded-full bg-orange-500' : 'h-full rounded-full bg-blue-500'}
        style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
      />
    </div>
  );
}

function LabeledProgress({ label, pct: value, tone }: { label: string; pct: number; tone: 'orange' | 'blue' }) {
  return (
    <div className="mb-1.5 last:mb-0">
      <div className="mb-0.5 flex items-center justify-between text-2xs">
        <span className="text-slate-600">{label}</span>
        <span className="font-mono text-slate-500">{pct(value)}</span>
      </div>
      <ProgressBar pct={value} tone={tone} />
    </div>
  );
}
