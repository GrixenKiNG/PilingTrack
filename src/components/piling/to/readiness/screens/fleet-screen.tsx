'use client';

import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronRight, ClipboardCheck, FileText, Gauge, Search, Wrench } from '@/components/piling/icons/unified-icons';
import { COMPACT_KPI_GRID, InfoRow, ScreenTitle, card } from '../settings/shared-ui';
import { kpiGridStyle } from '@/components/piling/kpi-tile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { EquipmentOption } from '../../to-module-bits';
import type { ReadinessStatus } from '../../readiness-model';
import { buildAuthoritativeReadinessPresentation, buildUnavailableReadinessPresentation, type AuthoritativeReadinessPresentation } from '../authoritative-presentation';
import { EquipmentPhoto, ReadinessRing, RefKpi, STAGE_CTA, downloadReadinessExport } from './shared';
import type { EquipmentDetailSnapshot, ReferenceUiProps } from './types';

const STATUS_META: Record<ReadinessStatus, { label: string; tone: string }> = {
  READY: { label: 'Готово к работе', tone: 'green' },
  ATTENTION: { label: 'Требует внимания', tone: 'orange' },
  NO_DATA: { label: 'Нет данных', tone: 'orange' },
  IN_REPAIR: { label: 'В ремонте', tone: 'red' },
  BLOCKED: { label: 'Недоступно', tone: 'red' },
  OVERDUE: { label: 'ТО просрочено', tone: 'red' },
};

function StatusPill({ status }: { status: ReadinessStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold',
        meta.tone === 'green' && 'bg-success/10 text-success-strong',
        meta.tone === 'orange' && 'bg-signal/10 text-signal-strong',
        meta.tone === 'red' && 'bg-destructive/10 text-destructive-strong',
      )}
    >
      {meta.tone === 'green' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
      {meta.label}
    </span>
  );
}

type FleetStatusFilter = 'all' | 'ready' | 'attention' | 'blocked';

/** Группа, в которую попадает установка по своему статусу готовности. */
function matchesFleetStatus(status: ReadinessStatus | undefined, filter: FleetStatusFilter): boolean {
  if (filter === 'all') return true;
  if (!status) return filter === 'attention';
  if (filter === 'ready') return status === 'READY';
  if (filter === 'attention') return status === 'ATTENTION' || status === 'NO_DATA';
  return status === 'IN_REPAIR' || status === 'BLOCKED' || status === 'OVERDUE';
}

/**
 * Строки показателей в правой панели «Техники»: осмотр, моточасы, дефекты, ТО.
 *
 * По макету это конкретные числа с переходом к источнику. До этого здесь
 * печатались пары «подпись доказательства + значок состояния» — ни одной
 * цифры, поэтому решить что-либо по панели было нельзя, только открыть
 * установку и посмотреть.
 */
function buildFleetMetricRows(
  presentation: AuthoritativeReadinessPresentation,
  equipment: EquipmentOption,
  detail: EquipmentDetailSnapshot | undefined,
): Array<{ key: string; icon: typeof FileText; label: string; value: string; tone?: 'danger'; href: string }> {
  const inspection = detail?.latestInspection ?? null;
  const nextAtHours = detail?.equipment?.nextMaintenanceAtHours;
  const hoursLeft = nextAtHours != null && equipment.engineHoursTotal != null
    ? Math.round(nextAtHours - equipment.engineHoursTotal)
    : null;
  const blockers = presentation.blockers.length;

  return [
    {
      key: 'inspection',
      icon: FileText,
      label: 'Осмотр',
      value: !inspection
        ? 'не проводился'
        : inspection.itemsTotal === 0 ? 'пункты не заданы' : `${inspection.itemsAnswered} из ${inspection.itemsTotal}`,
      href: inspection ? `/inspections/${inspection.id}` : '/inspections',
    },
    {
      key: 'meter',
      icon: Gauge,
      label: 'Моточасы',
      value: equipment.engineHoursTotal != null
        ? `${equipment.engineHoursTotal.toLocaleString('ru-RU')} м/ч`
        : '—',
      href: `/admin/equipment/${equipment.id}`,
    },
    {
      key: 'defects',
      icon: AlertTriangle,
      label: 'Дефекты',
      value: blockers > 0 ? `${blockers} критический` : 'нет критических',
      ...(blockers > 0 ? { tone: 'danger' as const } : {}),
      href: '/admin/maintenance',
    },
    {
      key: 'maintenance',
      icon: Wrench,
      label: 'ТО через',
      value: hoursLeft != null
        ? hoursLeft > 0 ? `${hoursLeft.toLocaleString('ru-RU')} м/ч` : `перепробег ${Math.abs(hoursLeft).toLocaleString('ru-RU')} м/ч`
        : 'регламент не задан',
      href: `/admin/equipment/${equipment.id}`,
    },
  ];
}

export function FleetScreen(props: ReferenceUiProps) {
  const readinessItems = Object.values(props.readinessByEquipment);
  const ready = readinessItems.filter((item) => item.status === 'READY').length;
  const attention = readinessItems.filter((item) => ['ATTENTION', 'NO_DATA'].includes(item.status)).length;
  const blocked = readinessItems.filter((item) => ['IN_REPAIR', 'BLOCKED', 'OVERDUE'].includes(item.status)).length;
  const averageReadiness = readinessItems.length > 0
    ? Math.round(readinessItems.reduce((sum, item) => sum + (item.score ?? 0), 0) / readinessItems.length)
    : 0;
  const working = props.fleetCards.filter((item) => item.equipmentStatus === 'working').length;
  const inMaintenance = props.fleetCards.filter((item) => item.equipmentStatus === 'repair').length;
  const withoutCrew = props.fleetCards.filter((item) => !item.assignedCrewName).length;
  const [query, setQuery] = useState('');
  // Плитки и левая панель раньше только показывали числа. Один фильтр на всех,
  // чтобы клик по «Недоступно» действительно сужал список.
  const [statusFilter, setStatusFilter] = useState<FleetStatusFilter>('all');
  const filtered = props.equipment.filter((item) => {
    const matchesQuery = `${item.name} ${item.model ?? ''}`.toLowerCase().includes(query.trim().toLowerCase());
    return matchesQuery && matchesFleetStatus(props.readinessByEquipment[item.id]?.status, statusFilter);
  });
  const selected = props.equipment.find((item) => item.id === props.selectedId) ?? props.equipment[0];
  const selectedReadiness = selected ? props.readinessByEquipment[selected.id] : null;
  const selectedFleet = selected ? props.fleetCards.find((item) => item.id === selected.id) : undefined;
  // Тот же авторитетный снимок, что и в центре готовности: иначе балл и
  // следующее действие на двух вкладках расходятся по одной установке.
  const selectedSnapshot = selected
    ? props.currentReadiness.find((item) => item.equipmentId === selected.id) ?? null
    : null;
  const selectedPresentation = selected
    ? (props.authoritativeReadinessError
        ? buildUnavailableReadinessPresentation(selectedSnapshot)
        : buildAuthoritativeReadinessPresentation(selectedSnapshot))
    : null;
  const selectedNextStage = selectedPresentation?.stages.find((stage) => stage.state !== 'pass') ?? null;
  const selectedDetail = selected ? props.details[selected.id] : undefined;
  const fleetMetrics = selected && selectedPresentation
    ? buildFleetMetricRows(selectedPresentation, selected, selectedDetail)
    : [];

  return (
    <>
      <ScreenTitle
        heading="Техника"
        subtitle="Готовность и состояние парка"
        actions={(
          <div className="flex gap-2">
            <Button asChild variant="outline"><Link href="/admin/equipment">+ Добавить технику</Link></Button>
            <Button variant="outline" onClick={() => void downloadReadinessExport('fleet', props.filters)
              .catch((error) => toast.error(error instanceof Error ? error.message : 'Не удалось сформировать экспорт'))}>↓ Экспорт</Button>
          </div>
        )}
      />
      <section className={COMPACT_KPI_GRID} style={kpiGridStyle(4)}>
        <RefKpi icon="equipment-rig" label="Всего" tone="neutral" value={props.equipment.length} onClick={() => setStatusFilter('all')} />
        <RefKpi icon="accepted" label="Готово" tone="success" value={ready} onClick={() => setStatusFilter('ready')} />
        <RefKpi icon="risk" label="Требует внимания" tone="warning" value={attention} alert={attention > 0} onClick={() => setStatusFilter('attention')} />
        <RefKpi icon="defect" label="Недоступно" tone="danger" value={blocked} alert={blocked > 0} onClick={() => setStatusFilter('blocked')} />
      </section>
      {/* Доли по макету: 0.46 / 2.42 / 1 ≈ 12 % / 63 % / 26 %. Правая панель
          была 290px и на широком мониторе оставалась зажатой, пока центру
          доставался весь избыток. Левому фильтру задан минимум 170px. */}
      <div className="mt-2 grid grid-cols-1 items-start gap-2 xl:grid-cols-[minmax(170px,0.46fr)_minmax(0,2.42fr)_minmax(0,1fr)]">
        <aside className={cn(card, 'p-3')}>
          <h2 className="font-bold">Парк техники</h2>
          <div className="relative mt-3"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Поиск установки" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск установки" className="h-9 bg-muted pl-9" /></div>
          <FilterGroup
            title="Статус готовности"
            active={statusFilter}
            onSelect={setStatusFilter}
            rows={[['all', 'Все установки', props.equipment.length], ['ready', 'Готово', ready], ['attention', 'Требует внимания', attention], ['blocked', 'Недоступно', blocked]]}
          />
          <FilterGroup title="Объект" rows={Array.from(new Set(props.fleetCards.map((item) => item.assignedSiteName || 'Без объекта'))).slice(0, 5).map((name) => [name, props.fleetCards.filter((item) => (item.assignedSiteName || 'Без объекта') === name).length])} />
          <FilterGroup title="Загрузка парка" rows={[['Высокая (≥75%)', ready], ['Средняя (35–74%)', attention], ['Низкая (<35%)', blocked]]} />
        </aside>
        <section>
          <div className="mb-2 flex items-center justify-between"><h2 className="font-bold">Установки</h2><span className="text-xs text-muted-foreground">Сортировка: <b className="text-muted-foreground">По готовности</b></span></div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {filtered.map((item) => {
              const state = props.readinessByEquipment[item.id];
              const fleet = props.fleetCards.find((entry) => entry.id === item.id);
              // Следующее действие — из авторитетного снимка, он есть по каждой
              // установке. Производная модель считает его по журналу, а журнал
              // грузится только для выбранной, поэтому на остальных карточках
              // стояла заглушка «Проверить данные».
              const itemSnapshot = props.currentReadiness.find((entry) => entry.equipmentId === item.id) ?? null;
              const itemStage = itemSnapshot?.facts
                ? buildAuthoritativeReadinessPresentation(itemSnapshot).stages.find((stage) => stage.state !== 'pass')
                : null;
              const itemAction = itemStage
                ? STAGE_CTA[itemStage.key]
                : itemSnapshot?.facts ? 'Контур закрыт' : state?.nextAction || 'Выполнить оценку готовности';
              return (
                <button key={item.id} type="button" onClick={() => props.onSelect(item.id)} className={cn(card, 'flex min-h-[140px] gap-2 p-2 text-left transition hover:border-signal/30', item.id === props.selectedId && 'border-signal')}>
                  <EquipmentPhoto cardData={fleet} name={item.name} className="h-[72px] w-[72px] shrink-0 self-center" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between"><div><h3 className="font-bold">{item.name}</h3><div className="mt-1 text-xs text-muted-foreground">{fleet?.assignedSiteName || 'Объект не назначен'}</div></div><ChevronRight className="h-4 w-4 text-muted-foreground" /></div>
                    <div className="mt-1 flex items-center gap-2"><ReadinessRing value={state?.score ?? null} size={52} />{state && <StatusPill status={state.status} />}</div>
                    <div className="mt-1 flex items-center gap-2 text-3xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        { }
                        <img src="/icons/pilingtrack/engine-hours.png" alt="" className="h-3.5 w-3.5 object-contain" />
                        {item.engineHoursTotal != null ? `${item.engineHoursTotal.toLocaleString('ru-RU')} м/ч` : '—'}
                      </span>
                      {/* Экипаж и оператор: по макету видно, КТО стоит на
                          установке, а не только номер бригады. */}
                      <span className="inline-flex min-w-0 items-center gap-1">
                        { }
                        <img src="/icons/pilingtrack/crew.png" alt="" className="h-3.5 w-3.5 object-contain" />
                        <span className="truncate">
                          {fleet?.assignedCrewName
                            ? [fleet.assignedCrewName, props.details[item.id]?.crew?.operator?.name].filter(Boolean).join(' · ')
                            : 'Бригада не назначена'}
                        </span>
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 border-t border-border pt-1 text-3xs"><span className="shrink-0 text-muted-foreground">Следующее действие</span><span className="truncate font-semibold text-signal-strong">{itemAction} ›</span></div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
        <aside className={cn(card, 'self-start p-3 xl:sticky xl:top-14')}>
          {selected ? (
            <>
              <h2 className="text-lg font-bold">{selected.name}</h2>
              <div className="mt-3 flex gap-2">
                <EquipmentPhoto cardData={selectedFleet} name={selected.name} className="h-[88px] w-[80px] shrink-0" priority />
                <div className="min-w-0 flex-1 space-y-2 text-xs">
                  <InfoRow label="Заводской №" value={props.details[selected.id]?.equipment?.serialNumber || '—'} />
                  <InfoRow label="Площадка" value={selectedFleet?.assignedSiteName || '—'} />
                </div>
                <ReadinessRing value={selectedReadiness?.score ?? null} size={56} />
              </div>
              <div className="mt-3">{selectedReadiness && <StatusPill status={selectedReadiness.status} />}</div>
              {/* Показатели строками с переходом к источнику — вместо пар
                  «подпись + значок», по которым нельзя было назвать ни одного
                  числа. */}
              <div className="mt-3 divide-y divide-border rounded-lg border border-border">
                {fleetMetrics.map((row) => {
                  const RowIcon = row.icon;
                  return (
                    <Link
                      key={row.key}
                      href={row.href}
                      className="flex min-h-11 items-center gap-2 px-2.5 py-2 transition hover:bg-muted/60"
                    >
                      <RowIcon className={cn('h-4 w-4 shrink-0', row.tone === 'danger' ? 'text-destructive-strong' : 'text-muted-foreground')} />
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold">{row.label}</span>
                      <span className={cn('shrink-0 text-xs font-semibold', row.tone === 'danger' ? 'text-destructive-strong' : 'text-foreground')}>
                        {row.value}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Link>
                  );
                })}
              </div>
              {selectedReadiness?.activeRecord && (
                <div className="mt-2 rounded-lg border border-destructive bg-destructive/10 p-2.5">
                  <div className="flex items-start gap-2">
                    { }
                    <img src="/icons/pilingtrack/defect.png" alt="" className="h-6 w-6 shrink-0 object-contain" />
                    <div className="min-w-0">
                      <div className="text-xs font-bold"><Link href={`/admin/maintenance/${selectedReadiness.activeRecord.id}`} className="hit-target hover:underline">{selectedReadiness.activeRecord.title}</Link></div>
                      <span className="mt-1 inline-flex rounded border border-destructive px-1.5 py-0.5 text-3xs font-semibold text-destructive-strong">Критическое</span>
                      <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">{selectedReadiness.reason}</p>
                    </div>
                  </div>
                </div>
              )}
              <div className="mt-2">
                <div className="mb-1.5 text-xs font-semibold text-muted-foreground">Следующее действие</div>
                <div className="flex items-center gap-2.5 rounded-[10px] border border-signal bg-signal/10 p-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold">
                      {selectedNextStage ? STAGE_CTA[selectedNextStage.key] : 'Все шаги контура закрыты'}
                    </div>
                    <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">{selectedReadiness?.reason || selectedPresentation?.description || 'Откройте центр готовности для продолжения процесса.'}</p>
                  </div>
                  {/* Плитка залита фирменным, а не бледной подложкой: в макете
                      это самый яркий элемент правой панели. */}
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-signal text-white"><ClipboardCheck className="h-5 w-5" /></span>
                </div>
                <Button className="mt-2 h-9 w-full bg-signal text-white hover:bg-signal-strong" onClick={() => props.onViewChange('readiness')}>
                  {selectedNextStage ? STAGE_CTA[selectedNextStage.key] : 'Открыть центр готовности'} <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                {/* Карточка, история и документы установки живут на её странице —
                    даём прямые переходы вместо декоративных вкладок. */}
                <div className="mt-2 grid grid-cols-3 gap-1">
                  {([
                    ['Карточка', `/admin/equipment/${selected.id}`],
                    ['История', `/admin/equipment/${selected.id}#history`],
                    ['Документы', `/admin/equipment/${selected.id}#documents`],
                  ] as const).map(([label, href]) => (
                    <Button key={label} asChild variant="outline" className="h-9 px-1 text-2xs">
                      <Link href={href}>{label}</Link>
                    </Button>
                  ))}
                </div>
              </div>
            </>
          ) : <div className="text-sm text-muted-foreground">Выберите установку</div>}
        </aside>
      </div>
      <section className="mt-2 grid grid-cols-2 overflow-hidden rounded-lg shadow-sm md:grid-cols-4">
        <div className="border-r border-border bg-card p-3">
          <div className="text-xs text-muted-foreground">Готовность парка</div>
          <div className="mt-1 flex items-center gap-3">
            <ReadinessRing value={averageReadiness} size={48} />
            {/*
              Раньше под подписью «Средняя готовность» стояло «{ready} из N» —
              количество ГОТОВЫХ установок, а кольцо рядом показывало средний
              балл. Две разные метрики под одной подписью. Теперь текст
              выражает тот же средний балл в установках: 76 % от 6 = 4,6.
            */}
            <div className="text-xs leading-relaxed text-muted-foreground">
              Средняя готовность<br />
              <b className="text-muted-foreground tabular-nums">
                {(averageReadiness / 100 * props.equipment.length).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} из {props.equipment.length} установок
              </b>
            </div>
          </div>
        </div>
        {[
          ['В работе', working, 'equipment-rig' as const],
          ['На обслуживании', inMaintenance, 'repair' as const],
          ['Без экипажа', withoutCrew, 'crew' as const],
        ].map(([label, value, icon], index) => (
          <div key={label} className={cn('bg-card p-3', index < 2 && 'md:border-r md:border-border')}>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 flex items-center justify-between">
              <span className="font-mono text-xl font-bold tabular-nums text-foreground">{value}</span>
              { }
              <img src={`/icons/pilingtrack/${icon}.png`} alt="" className="h-[34px] w-[34px] object-contain" />
            </div>
          </div>
        ))}
      </section>
    </>
  );
}

function FilterGroup({ title: groupTitle, rows, active, onSelect }: {
  title: string;
  /** Без onSelect — просто сводка, с ним каждая строка выбирает фильтр. */
  rows: Array<readonly [string, number]> | Array<readonly [FleetStatusFilter, string, number]>;
  active?: FleetStatusFilter;
  onSelect?: (value: FleetStatusFilter) => void;
}) {
  return (
    <div className="mt-4">
      <h3 className="text-xs font-bold">{groupTitle}</h3>
      <div className="mt-2 space-y-1.5">
        {rows.map((row, index) => {
          const selectable = onSelect != null && row.length === 3;
          const [value, label, count] = row.length === 3
            ? row as readonly [FleetStatusFilter, string, number]
            : ['all' as FleetStatusFilter, ...(row as readonly [string, number])] as const;
          const isActive = selectable ? active === value : index === 0;
          const inner = (
            <>
              <span><span className={cn('mr-2 inline-block h-2 w-2 rounded-full border', isActive ? 'border-signal bg-signal-strong' : 'border-border')} />{label}</span>
              <b>{count}</b>
            </>
          );
          return selectable
            ? <button key={label} type="button" aria-pressed={isActive} onClick={() => onSelect?.(value)} className={cn('flex min-h-11 w-full items-center justify-between rounded px-1 text-left text-xs transition hover:bg-muted/60', isActive ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{inner}</button>
            : <div key={label} className="flex items-center justify-between text-xs text-muted-foreground">{inner}</div>;
        })}
      </div>
    </div>
  );
}
