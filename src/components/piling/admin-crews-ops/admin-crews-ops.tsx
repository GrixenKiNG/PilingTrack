'use client';

import { useMemo, useState } from 'react';
import { Users, UserCog, Wrench, MapPin, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { QueryErrorBanner } from '@/components/piling/async-ui';
import { pluralizeRu } from '@/lib/format';
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
import { useCrewsOpsData, type CrewOpsRow } from './use-crews-ops-data';

type QuickKey = 'all' | 'active' | 'inactive' | 'noAssistants';

const QUICK_FILTERS: OpsQuickFilter<QuickKey>[] = [
  { key: 'all', label: 'Все' },
  { key: 'active', label: 'Активные' },
  { key: 'inactive', label: 'Неактивные' },
  { key: 'noAssistants', label: 'Без помощников' },
];

function crewRisk(row: CrewOpsRow) {
  return resolveRisk(
    [
      [!row.isActive, 'critical', 'Неактивна'],
      [row.assistantsCount === 0, 'warn', 'Без помощников'],
    ],
    'Активна',
  );
}

export function AdminCrewsOps() {
  const { rows, loading, error, reload } = useCrewsOpsData();
  const [quick, setQuick] = useState<QuickKey>('all');
  const [activeId, setActiveId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (quick === 'active') return r.isActive;
      if (quick === 'inactive') return !r.isActive;
      if (quick === 'noAssistants') return r.assistantsCount === 0;
      return true;
    });
  }, [rows, quick]);

  const active = useMemo(
    () => filtered.find((r) => r.id === activeId) ?? filtered[0] ?? null,
    [filtered, activeId],
  );

  const kpis: OpsKpiItem[] = useMemo(() => {
    const activeCount = rows.filter((r) => r.isActive).length;
    const assistants = rows.reduce((s, r) => s + r.assistantsCount, 0);
    const sites = new Set(rows.map((r) => r.siteId)).size;
    return [
      { label: 'Бригады', value: String(rows.length), detail: 'всего', icon: Users, tone: 'slate' },
      { label: 'Активные', value: String(activeCount), detail: 'в работе', icon: UserCog, tone: 'emerald' },
      { label: 'Неактивные', value: String(rows.length - activeCount), detail: 'выключены', icon: Users, tone: rows.length - activeCount > 0 ? 'amber' : 'slate' },
      { label: 'Объекты', value: String(sites), detail: 'задействовано', icon: MapPin, tone: 'blue' },
      { label: 'Помощники', value: String(assistants), detail: 'суммарно', icon: UserCog, tone: 'slate' },
    ];
  }, [rows]);

  const columns: OpsColumn<CrewOpsRow>[] = [
    {
      key: 'name',
      header: 'Бригада',
      width: 'minmax(160px,1.4fr)',
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-slate-950">{r.name || 'Без названия'}</div>
          <div className="mt-0.5 flex items-center gap-1.5 truncate text-2xs text-slate-400">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{r.siteName}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'operator',
      header: 'Оператор',
      width: 'minmax(140px,1fr)',
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate text-slate-800">{r.operatorName}</div>
          <div className="mt-0.5 text-2xs text-slate-400">
            {r.assistantsCount} {pluralizeRu(r.assistantsCount, ['помощник', 'помощника', 'помощников'])}
          </div>
        </div>
      ),
    },
    {
      key: 'equipment',
      header: 'Установка',
      width: 'minmax(130px,1fr)',
      cell: (r) => (
        <div className="flex items-center gap-1.5 truncate text-slate-700">
          <Wrench className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="truncate">{r.equipmentName}</span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Статус',
      width: '120px',
      cell: (r) => {
        const risk = crewRisk(r);
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
      icon={Users}
      title="Бригады"
      countLabel={`${filtered.length} ${pluralizeRu(filtered.length, ['бригада', 'бригады', 'бригад'])}`}
      subtitle="Сменные назначения: оператор, помощники, установка, объект"
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
          <QueryErrorBanner title="Не удалось загрузить бригады" message={error} onRetry={reload} />
        </div>
      </div>
    );
  }

  return (
    <OpsPage
      header={header}
      aside={active ? <CrewDetail row={active} /> : <OpsDetailEmpty message="Выберите бригаду, чтобы увидеть состав и историю назначений." />}
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
        getRowId={(r) => r.id}
        activeId={active?.id ?? null}
        onRowSelect={(r) => setActiveId(r.id)}
        empty={<OpsTableEmpty icon={Users} title="Бригады не найдены" hint="Измените быстрый фильтр." />}
      />
    </OpsPage>
  );
}

function CrewDetail({ row }: { row: CrewOpsRow }) {
  const risk = crewRisk(row);
  const history = useEntityHistory('crews', row.id);
  return (
    <OpsDetailPanel
      title={row.name || 'Без названия'}
      subtitle={`Бригада · ${row.siteName}`}
      status={<OpsRiskBadge level={risk.level} label={risk.label} />}
    >
      <div className="grid grid-cols-2 divide-x rounded-md border border-slate-200 bg-slate-50">
        <OpsFact label="Оператор" value={row.operatorName} />
        <OpsFact label="Помощники" value={String(row.assistantsCount)} />
      </div>
      <div className="grid grid-cols-2 divide-x rounded-md border border-slate-200">
        <OpsFact label="Установка" value={row.equipmentName} />
        <OpsFact label="Объект" value={row.siteName} />
      </div>

      {/* Live assignment history from GET /api/audit (scope 'crews'). */}
      <OpsHistoryList entries={history.entries} loading={history.loading} error={history.error} title="История назначений" />
    </OpsDetailPanel>
  );
}
