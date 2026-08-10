'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Gauge,
  HardHat,
  History,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Users,
  Wrench,
} from '@/components/piling/icons/unified-icons';
import { KPI_GRID, KpiTile, kpiGridStyle } from '@/components/piling/kpi-tile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { PRIORITY_LABEL, type MaintenancePriority } from '@/components/piling/maintenance/maintenance-labels';
import { MaintenancePlansPanel } from './maintenance-plans-panel';
import { MeterReadingsPanel } from './meter-readings-panel';
import {
  EmptyBlock,
  JournalRow,
  LoadingBlock,
  STATUS_LABEL,
  TYPE_LABEL,
  type EquipmentOption,
} from './to-module-bits';
import {
  computeToStats,
  isInspectionRecord,
  isOpenRecord,
  type JournalRecord,
} from './to-stats';
import {
  computeReadinessSummary,
  type EquipmentReadiness,
  type ReadinessStatus,
} from './readiness-model';

export interface CrewSummary {
  id: string;
  name: string;
  isActive: boolean;
  operator: { id: string; name: string; role: string } | null;
  equipment: { id: string; name: string } | null;
  site: { id: string; name: string } | null;
  assistants: Array<{ id: string; name: string }>;
}

export interface MaintenanceSummary {
  id: string;
  type: string;
  status: string;
  priority: string;
  title: string;
  description?: string | null;
  scheduledAt: string | null;
  completedAt: string | null;
  createdAt: string;
  equipment: {
    id: string;
    name: string;
    model: string | null;
  } | null;
}

interface SharedViewProps {
  equipment: EquipmentOption[];
  readinessByEquipment: Record<string, EquipmentReadiness>;
}

const STATUS_META: Record<
  ReadinessStatus,
  { label: string; className: string }
> = {
  READY: { label: 'Готово', className: 'border-success/30 bg-success/10 text-success-strong' },
  ATTENTION: { label: 'Требует решения', className: 'border-warning/30 bg-warning/10 text-warning-strong' },
  NO_DATA: { label: 'Нет данных', className: 'border-border bg-muted text-muted-foreground' },
  IN_REPAIR: { label: 'В ремонте', className: 'border-destructive/30 bg-destructive/10 text-destructive-strong' },
  BLOCKED: { label: 'Недоступно', className: 'border-destructive/30 bg-destructive/10 text-destructive-strong' },
  OVERDUE: { label: 'ТО просрочено', className: 'border-destructive/30 bg-destructive/10 text-destructive-strong' },
};

function ViewHeading({
  title,
  description,
  icon: Icon,
  actions,
}: {
  title: string;
  description: string;
  icon: typeof ShieldCheck;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-signal/10">
          <Icon className="h-6 w-6 text-signal-strong" />
        </span>
        <div>
          <h2 className="text-lg font-bold text-foreground">{title}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {actions}
    </header>
  );
}

function StatusBadge({ status }: { status: ReadinessStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className={cn('inline-flex rounded-full border px-2 py-1 text-xs font-bold', meta.className)}>
      {meta.label}
    </span>
  );
}

function ProgressBar({ value, tone = 'bg-signal' }: { value: number; tone?: string }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-muted" aria-label={`${value}%`}>
      <div className={cn('h-full rounded-full', tone)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function ReadinessFleetView({
  equipment,
  readinessByEquipment,
  selectedId,
  onSelect,
}: SharedViewProps & {
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'ready' | 'attention' | 'blocked'>('all');
  const readiness = Object.values(readinessByEquipment);
  const summary = computeReadinessSummary(readiness);
  const filtered = equipment.filter((item) => {
    const state = readinessByEquipment[item.id];
    const textMatch = `${item.name} ${item.model ?? ''}`.toLowerCase().includes(query.trim().toLowerCase());
    const stateMatch = filter === 'all'
      || (filter === 'ready' && state?.status === 'READY')
      || (filter === 'attention' && ['ATTENTION', 'NO_DATA'].includes(state?.status))
      || (filter === 'blocked' && ['IN_REPAIR', 'BLOCKED', 'OVERDUE'].includes(state?.status));
    return textMatch && stateMatch;
  });

  return (
    <div className="space-y-3">
      <ViewHeading
        title="Техника"
        description="Готовность каждой установки и причина ограничения"
        icon={HardHat}
        actions={(
          <div className="relative w-full lg:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Установка или модель" className="h-10 pl-9" />
          </div>
        )}
      />
      <section className={KPI_GRID} style={kpiGridStyle(4)}>
        <KpiTile icon="equipment" label="Всего техники" value={summary.total} detail="установок в доступном парке" />
        <KpiTile icon="accepted" label="Готово" value={summary.ready} detail="полный комплект подтверждений" />
        <KpiTile icon="risk" label="Требует внимания" value={summary.attention + summary.noData} detail={`${summary.noData} без полного комплекта данных`} alert={summary.attention + summary.noData > 0} />
        <KpiTile icon="defect" label="Недоступно" value={summary.blocked} detail="ремонт, блокировка или просроченное ТО" alert={summary.blocked > 0} />
      </section>
      <div className="grid gap-3 xl:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <h3 className="px-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Состояние</h3>
          <div className="mt-2 space-y-1">
            {([
              ['all', 'Все установки', summary.total],
              ['ready', 'Готово', summary.ready],
              ['attention', 'Требует решения', summary.attention + summary.noData],
              ['blocked', 'Недоступно', summary.blocked],
            ] as const).map(([id, label, count]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-semibold',
                  filter === id ? 'bg-signal/10 text-signal-strong' : 'text-muted-foreground hover:bg-muted',
                )}
              >
                <span>{label}</span><span className="font-mono">{count}</span>
              </button>
            ))}
          </div>
        </aside>
        <section className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {filtered.map((item) => {
            const state = readinessByEquipment[item.id];
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                className={cn(
                  'rounded-xl border bg-card p-4 text-left shadow-sm transition hover:border-signal/30 hover:shadow-md',
                  item.id === selectedId ? 'border-signal/30 ring-2 ring-signal/30' : 'border-border',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-foreground">{item.name}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{item.model || 'Модель не указана'}</p>
                  </div>
                  {state && <StatusBadge status={state.status} />}
                </div>
                <div className="mt-5 flex items-end justify-between gap-4">
                  <div>
                    <div className="text-xs text-muted-foreground">Индекс готовности</div>
                    <div className="mt-1 font-mono text-2xl font-bold text-foreground">{state?.score ?? '—'}</div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    {item.engineHoursTotal != null ? `${item.engineHoursTotal.toLocaleString('ru-RU')} м.ч.` : 'Нет моточасов'}
                    <br />
                    {item.crewCount > 0 ? `Бригад: ${item.crewCount}` : 'Бригада не назначена'}
                  </div>
                </div>
                <div className="mt-3"><ProgressBar value={state?.score ?? 0} tone={state?.canOperate ? 'bg-success-strong' : 'bg-signal'} /></div>
                <p className="mt-3 min-h-10 text-xs leading-relaxed text-muted-foreground">{state?.reason}</p>
              </button>
            );
          })}
          {filtered.length === 0 && <div className="md:col-span-2 2xl:col-span-3"><EmptyBlock label="По выбранному фильтру техника не найдена" tall /></div>}
        </section>
      </div>
    </div>
  );
}

export function ReadinessShiftsView({
  equipment,
  readinessByEquipment,
  crews,
}: SharedViewProps & { crews: CrewSummary[] }) {
  const activeCrews = crews.filter((crew) => crew.isActive);
  const readyCrews = activeCrews.filter((crew) => crew.equipment && readinessByEquipment[crew.equipment.id]?.canOperate);
  const blockedCrews = activeCrews.filter((crew) => crew.equipment && ['IN_REPAIR', 'BLOCKED', 'OVERDUE'].includes(readinessByEquipment[crew.equipment.id]?.status));
  const assignedIds = new Set(activeCrews.map((crew) => crew.equipment?.id).filter(Boolean));

  return (
    <div className="space-y-3">
      <ViewHeading title="Смены" description="Текущие назначения бригад и готовность техники к началу работы" icon={Users} actions={<Button asChild variant="outline"><Link href="/admin/crews">Управление бригадами</Link></Button>} />
      <section className={KPI_GRID} style={kpiGridStyle(4)}>
        <KpiTile icon={Users} label="Активные назначения" value={activeCrews.length} detail="по данным модуля «Бригады»" />
        <KpiTile icon="accepted" label="Готовы к работе" value={readyCrews.length} detail="назначение и техника подтверждены" />
        <KpiTile icon="risk" label="Ожидают решения" value={Math.max(0, activeCrews.length - readyCrews.length - blockedCrews.length)} detail="не хватает подтверждений" alert={activeCrews.length > readyCrews.length} />
        <KpiTile icon="defect" label="Блокированы" value={blockedCrews.length} detail="техника недоступна" alert={blockedCrews.length > 0} />
      </section>
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-2 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-bold text-foreground">Текущие назначения</h3>
            <p className="mt-1 text-xs text-muted-foreground">Время смены не показывается, пока в проекте нет сущности сменного графика.</p>
          </div>
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">Сегодня · {new Date().toLocaleDateString('ru-RU')}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr><th className="px-4 py-3">Бригада</th><th className="px-4 py-3">Оператор</th><th className="px-4 py-3">Объект</th><th className="px-4 py-3">Установка</th><th className="px-4 py-3">Состав</th><th className="px-4 py-3 text-right">Готовность</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {activeCrews.map((crew) => {
                const state = crew.equipment ? readinessByEquipment[crew.equipment.id] : null;
                return (
                  <tr key={crew.id} className="hover:bg-muted">
                    <td className="px-4 py-3 font-semibold text-foreground">{crew.name}</td>
                    <td className="px-4 py-3 text-foreground">{crew.operator?.name ?? 'Не назначен'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{crew.site?.name ?? 'Не указан'}</td>
                    <td className="px-4 py-3 text-foreground">{crew.equipment?.name ?? 'Не назначена'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{1 + crew.assistants.length} чел.</td>
                    <td className="px-4 py-3 text-right">{state ? <StatusBadge status={state.status} /> : <span className="text-xs text-muted-foreground">Нет техники</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {activeCrews.length === 0 && <EmptyBlock label="Активных назначений бригад нет" tall />}
      </section>
      {equipment.some((item) => !assignedIds.has(item.id)) && (
        <div className="flex gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning-strong">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div><strong>Есть техника без назначения:</strong> {equipment.filter((item) => !assignedIds.has(item.id)).map((item) => item.name).join(', ')}.</div>
        </div>
      )}
    </div>
  );
}

export function ReadinessPermitsView({
  equipment,
  readinessByEquipment,
  crews,
}: SharedViewProps & { crews: CrewSummary[] }) {
  const summary = computeReadinessSummary(Object.values(readinessByEquipment));
  const crewByEquipment = new Map(
    crews.flatMap((crew) =>
      crew.isActive && crew.equipment ? [[crew.equipment.id, crew] as const] : []),
  );

  return (
    <div className="space-y-3">
      <ViewHeading title="Наряд-допуски" description="Предварительная проверка условий допуска перед созданием юридически значимого документа" icon={ClipboardCheck} />
      <section className={KPI_GRID} style={kpiGridStyle(4)}>
        <KpiTile icon={ClipboardList} label="Проверок условий" value={equipment.length} detail="по установкам текущего парка" />
        <KpiTile icon="accepted" label="Условия выполнены" value={summary.ready} detail="можно переходить к оформлению" />
        <KpiTile icon="risk" label="Ожидают данных" value={summary.attention + summary.noData} detail="требуется подтверждение" alert={summary.attention + summary.noData > 0} />
        <KpiTile icon="defect" label="Запуск запрещён" value={summary.blocked} detail="есть блокирующее условие" alert={summary.blocked > 0} />
      </section>
      <div className="flex gap-3 rounded-xl border border-info/30 bg-info/10 p-4 text-sm leading-relaxed text-info-strong">
        <ShieldAlert className="h-5 w-5 shrink-0" />
        <div><strong>Контур предварительный.</strong> В текущей базе нет отдельной сущности наряд-допуска, его номера, срока действия и маршрута согласования. Экран не подменяет документ и не выдаёт допуск автоматически.</div>
      </div>
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border p-4"><h3 className="font-bold text-foreground">Реестр условий допуска</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[940px] text-left text-sm">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr><th className="px-4 py-3">Установка</th><th className="px-4 py-3">Объект</th><th className="px-4 py-3">Бригада</th><th className="px-4 py-3">Осмотр</th><th className="px-4 py-3">ТО</th><th className="px-4 py-3">Комплектность</th><th className="px-4 py-3 text-right">Решение</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {equipment.map((item) => {
                const state = readinessByEquipment[item.id];
                const crew = crewByEquipment.get(item.id);
                const inspection = state?.evidence.find((entry) => entry.key === 'inspection');
                const maintenance = state?.evidence.find((entry) => entry.key === 'maintenance');
                const completed = state?.evidence.filter((entry) => entry.state === 'pass').length ?? 0;
                return (
                  <tr key={item.id} className="hover:bg-muted">
                    <td className="px-4 py-3"><div className="font-semibold text-foreground">{item.name}</div><div className="text-xs text-muted-foreground">{item.model || 'Модель не указана'}</div></td>
                    <td className="px-4 py-3 text-muted-foreground">{crew?.site?.name ?? 'Не назначен'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{crew?.name ?? 'Не назначена'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{inspection?.value ?? 'Нет данных'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{maintenance?.value ?? 'Нет данных'}</td>
                    <td className="px-4 py-3"><span className="font-mono font-bold text-foreground">{completed}/5</span></td>
                    <td className="px-4 py-3 text-right">{state && <StatusBadge status={state.status} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

type MaintenanceTab = 'orders' | 'journal' | 'meters' | 'plans';

export function ReadinessMaintenanceView({
  selected,
  equipmentId,
  records,
  allMaintenance,
  loading,
  onMeterChanged,
}: {
  selected: EquipmentOption | null;
  equipmentId: string;
  records: JournalRecord[];
  allMaintenance: MaintenanceSummary[];
  loading: boolean;
  onMeterChanged: (value: number | null) => void;
}) {
  const [tab, setTab] = useState<MaintenanceTab>('orders');
  const [query, setQuery] = useState('');
  const stats = computeToStats(records);
  const filtered = records.filter((record) => {
    const text = query.trim().toLowerCase();
    return !text || `${record.title} ${TYPE_LABEL[record.type] ?? record.type} ${STATUS_LABEL[record.status] ?? record.status}`.toLowerCase().includes(text);
  });
  const selectedOrders = allMaintenance.filter((record) => !equipmentId || record.equipment?.id === equipmentId);
  const openOrders = selectedOrders.filter((record) => !['DONE', 'CANCELLED'].includes(record.status));
  const critical = openOrders.filter((record) => ['CRITICAL', 'HIGH'].includes(record.priority));

  return (
    <div className="space-y-3">
      <ViewHeading title="Обслуживание" description="Наряды, журнал, наработка и регламенты выбранной установки" icon={Wrench} actions={<Button asChild><Link href="/admin/maintenance">Открыть все наряды</Link></Button>} />
      <section className={KPI_GRID} style={kpiGridStyle(4)}>
        <KpiTile icon="defect" label="Критические дефекты" value={critical.length} detail="в открытых нарядах" alert={critical.length > 0} />
        <KpiTile icon={ClipboardList} label="Открытые работы" value={openOrders.length} detail={selected?.name ?? 'Выберите установку'} />
        <KpiTile icon={History} label="Записи журнала" value={records.length} detail={`${stats.open} незакрытых`} />
        <KpiTile icon={Gauge} label="Наработка" value={selected?.engineHoursTotal != null ? `${selected.engineHoursTotal.toLocaleString('ru-RU')} м.ч.` : '—'} detail="последнее показание" />
      </section>
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex gap-1 overflow-x-auto border-b border-border p-2">
          {([
            ['orders', 'Наряды', ClipboardList],
            ['journal', 'Журнал ТО', History],
            ['meters', 'Моточасы', Gauge],
            ['plans', 'Регламенты', CalendarClock],
          ] as Array<[MaintenanceTab, string, typeof History]>).map(([id, label, Icon]) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={cn('inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold', tab === id ? 'bg-slate-900 text-white' : 'text-muted-foreground hover:bg-muted')}>
              <Icon className="h-4 w-4" />{label}
            </button>
          ))}
        </div>
        {tab === 'orders' && (
          <div className="p-3">
            {selectedOrders.length === 0 ? <EmptyBlock label="По установке нет нарядов обслуживания" tall /> : (
              <div className="grid gap-3 lg:grid-cols-2">
                {selectedOrders.map((record) => (
                  <article key={record.id} className="rounded-lg border border-border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div><h3 className="font-semibold text-foreground">{record.title}</h3><p className="mt-1 text-xs text-muted-foreground">{record.equipment?.name}</p></div>
                      <span className={cn('rounded-full px-2 py-1 text-xs font-bold', ['CRITICAL', 'HIGH'].includes(record.priority) ? 'bg-destructive/10 text-destructive-strong' : 'bg-muted text-muted-foreground')}>{PRIORITY_LABEL[record.priority as MaintenancePriority] ?? record.priority}</span>
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{record.description || 'Описание не заполнено'}</p>
                    <div className="mt-4 flex justify-between border-t border-border pt-3 text-xs text-muted-foreground"><span>{TYPE_LABEL[record.type] ?? record.type}</span><span>{STATUS_LABEL[record.status] ?? record.status}</span></div>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}
        {tab === 'journal' && (
          <>
            <div className="border-b border-border p-3"><div className="relative max-w-sm"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по журналу" className="pl-9" /></div></div>
            {loading ? <LoadingBlock label="Загрузка журнала" tall /> : filtered.length === 0 ? <EmptyBlock label="По установке нет записей журнала" tall /> : (
              <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-muted text-xs text-muted-foreground"><tr><th className="px-3 py-2">Дата</th><th className="px-3 py-2">Тип</th><th className="px-3 py-2">Запись</th><th className="px-3 py-2">Наработка</th><th className="px-3 py-2">Оценка</th><th className="px-3 py-2 text-right">Статус</th></tr></thead><tbody className="divide-y divide-border">{filtered.map((record) => <JournalRow key={record.id} record={record} />)}</tbody></table></div>
            )}
          </>
        )}
        {tab === 'meters' && <div className="p-3">{selected ? <MeterReadingsPanel equipmentId={selected.id} onChanged={onMeterChanged} /> : <EmptyBlock label="Выберите установку" tall />}</div>}
        {tab === 'plans' && <div className="p-3">{selected ? <MaintenancePlansPanel equipmentId={selected.id} /> : <EmptyBlock label="Выберите установку" tall />}</div>}
      </section>
    </div>
  );
}

export function ReadinessReportsView({
  equipment,
  readinessByEquipment,
  journals,
}: SharedViewProps & { journals: Record<string, JournalRecord[]> }) {
  const readiness = Object.values(readinessByEquipment);
  const summary = computeReadinessSummary(readiness);
  const allRecords = Object.values(journals).flat();
  const inspections = allRecords.filter(isInspectionRecord);
  const closed = allRecords.filter((record) => !isOpenRecord(record));
  const scored = inspections.map((record) => record.inspection?.healthScore).filter((score): score is number => typeof score === 'number');
  const averageScore = scored.length ? Math.round(scored.reduce((sum, value) => sum + value, 0) / scored.length) : null;
  const blockerRows = [
    ['Нет подтверждений', summary.noData],
    ['Ремонт / блокировка / просрочка', summary.blocked],
    ['Требует решения', summary.attention],
  ] as const;
  const maxBlockers = Math.max(1, ...blockerRows.map(([, count]) => count));

  return (
    <div className="space-y-3">
      <ViewHeading title="Отчёты" description="Фактический срез готовности и доказательств на текущий момент" icon={BarChart3} actions={<span className="rounded-lg border border-border bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground">Срез · {new Date().toLocaleString('ru-RU')}</span>} />
      <section className={KPI_GRID} style={kpiGridStyle(5)}>
        <KpiTile icon="technical-readiness" label="Готовность парка" value={`${summary.readinessPercent}%`} detail={`${summary.ready} из ${summary.total}`} />
        <KpiTile icon="accepted" label="Допущено установок" value={summary.ready} detail="по текущим доказательствам" />
        <KpiTile icon="defect" label="Заблокировано" value={summary.blocked} detail="критические ограничения" alert={summary.blocked > 0} />
        <KpiTile icon={ClipboardCheck} label="Закрыто записей" value={closed.length} detail={`всего записей: ${allRecords.length}`} />
        <KpiTile icon={Gauge} label="Средняя оценка" value={averageScore ?? '—'} detail="по завершённым осмотрам" />
      </section>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.7fr)]">
        <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between"><h3 className="font-bold text-foreground">Готовность по установкам</h3><span className="text-xs text-muted-foreground">текущий срез</span></div>
          <div className="mt-4 space-y-3">
            {equipment.map((item) => {
              const state = readinessByEquipment[item.id];
              return (
                <div key={item.id} className="grid items-center gap-3 sm:grid-cols-[180px_minmax(0,1fr)_110px]">
                  <div className="truncate text-sm font-semibold text-foreground">{item.name}</div>
                  <ProgressBar value={state?.score ?? 0} tone={state?.canOperate ? 'bg-success-strong' : 'bg-signal'} />
                  <div className="text-right">{state && <StatusBadge status={state.status} />}</div>
                </div>
              );
            })}
          </div>
        </section>
        <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="font-bold text-foreground">Структура ограничений</h3>
          <p className="mt-1 text-xs text-muted-foreground">Без искусственной истории: только текущие причины.</p>
          <div className="mt-5 space-y-5">
            {blockerRows.map(([label, count]) => (
              <div key={label}>
                <div className="mb-2 flex items-center justify-between text-sm"><span className="text-muted-foreground">{label}</span><strong className="font-mono text-foreground">{count}</strong></div>
                <ProgressBar value={(count / maxBlockers) * 100} tone={count > 0 ? 'bg-signal' : 'bg-success-strong'} />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export function ReadinessSettingsView() {
  const rules = [
    ['Осмотр текущей смены', 'Обязательное подтверждение', 'Блокирует'],
    ['Показание моточасов', 'Актуальная наработка', 'Блокирует'],
    ['Назначенная бригада', 'Активное назначение', 'Блокирует'],
    ['Плановое ТО', 'Срок не нарушен', 'Блокирует'],
    ['Ремонт и неисправности', 'Нет открытых записей', 'Блокирует'],
  ];
  const links = [
    ['/admin/checklists', 'Чек-листы осмотров', ClipboardCheck],
    ['/admin/crews', 'Бригады и назначения', Users],
    ['/admin/dictionaries', 'Справочники', FileText],
    ['/admin/users', 'Пользователи и роли', HardHat],
    ['/admin/settings', 'Рабочее пространство', Settings2],
  ] as const;

  return (
    <div className="space-y-3">
      <ViewHeading title="Настройки техготовности" description="Действующие правила принятия решения и связанные административные разделы" icon={Settings2} />
      <div className="grid gap-3 xl:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <h3 className="px-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Разделы</h3>
          <nav className="mt-2 space-y-1">
            {links.map(([href, label, Icon], index) => (
              <Link key={href} href={href} className={cn('flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold', index === 0 ? 'bg-signal/10 text-signal-strong' : 'text-muted-foreground hover:bg-muted')}>
                <Icon className="h-4 w-4" />{label}
              </Link>
            ))}
          </nav>
        </aside>
        <div className="space-y-3">
          <section className="rounded-xl border border-border bg-card shadow-sm">
            <div className="border-b border-border p-4">
              <h3 className="font-bold text-foreground">Правила решения о готовности</h3>
              <p className="mt-1 text-xs text-muted-foreground">Консервативная модель: отсутствие данных не считается успешной проверкой.</p>
            </div>
            <div className="divide-y divide-border">
              {rules.map(([name, condition, effect]) => (
                <div key={name} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px] sm:items-center">
                  <div className="font-semibold text-foreground">{name}</div>
                  <div className="text-sm text-muted-foreground">{condition}</div>
                  <div className="text-right"><span className="rounded-full bg-destructive/10 px-2 py-1 text-xs font-bold text-destructive-strong">{effect}</span></div>
                </div>
              ))}
            </div>
          </section>
          <div className="flex gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm leading-relaxed text-warning-strong">
            <ShieldAlert className="h-5 w-5 shrink-0" />
            <div><strong>Правила доступны только для просмотра.</strong> Для редактирования весов, маршрутов согласования и электронных допусков нужна отдельная серверная модель с аудитом изменений.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
