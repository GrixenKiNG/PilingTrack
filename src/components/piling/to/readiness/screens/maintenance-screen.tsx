'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AlertTriangle, CalendarClock, Search, Wrench } from '@/components/piling/icons/unified-icons';
import { PilingIcon, type PilingIconName } from '@/components/piling/icons';
import { COMPACT_KPI_GRID, ScreenTitle, card } from '../settings/shared-ui';
import { kpiGridStyle } from '@/components/piling/kpi-tile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDateTimeInTimezone, getTodayInTimezone } from '@/lib/timezone';
import { cn } from '@/lib/utils';
import { PRIORITY_LABEL, STATUS_LABEL, type MaintenancePriority, type MaintenanceStatus } from '@/components/piling/maintenance/maintenance-labels';
import type { MaintenanceSummary } from '../../readiness-design-views';
import { DefectsPanel } from './defects-panel';
import { EquipmentPhoto, RefKpi } from './shared';
import type { ReferenceUiProps } from './types';

/**
 * За сколько моточасов до ТО полоса пробега желтеет.
 *
 * Это порог показа, а не правило: блокировку даёт перепробег
 * (`MAINTENANCE_OVERDUE_50H`), а здесь мы лишь заранее подсвечиваем. Значение
 * равно интервалу ТО-1 — предупреждение появляется примерно за один цикл.
 */
const MAINTENANCE_SOON_HOURS = 250;

export function MaintenanceScreen(props: ReferenceUiProps) {
  const [maintenanceFilter, setMaintenanceFilter] = useState<'ALL' | 'CRITICAL' | 'ACTIVE' | 'PLANNED'>('ALL');
  const [maintenanceQuery, setMaintenanceQuery] = useState('');
  const open = props.maintenance.filter((record) => !['DONE', 'CANCELLED'].includes(record.status));
  const critical = open.filter((record) => ['CRITICAL', 'HIGH'].includes(record.priority));
  // Плитка «Критические дефекты» считала наряды ТО высокого приоритета —
  // подпись обещала не то, что показывала. Дефекты — отдельная сущность, и
  // теперь они приходят с сервера.
  const openDefects = props.defects.filter((defect) => defect.status === 'OPEN' || defect.status === 'IN_WORK');
  const blockingDefects = openDefects.filter((defect) => defect.severity === 'CRITICAL');
  const planned = open.filter((record) => ['PLANNED', 'ASSIGNED'].includes(record.status));
  const servicePercent = props.equipment.length ? Math.round(((props.equipment.length - critical.length) / props.equipment.length) * 100) : 0;
  const timezone = props.bootstrap?.tenant.timezone;
  const todayIso = getTodayInTimezone(timezone);
  // «Работы сегодня» считали ВСЕ открытые заявки — счётчик не имел отношения к
  // сегодняшнему дню. Берём назначенные или начатые на сегодня.
  const todayWork = open.filter((record) =>
    (record.scheduledAt ?? record.startedAt ?? '').slice(0, 10) === todayIso);
  /**
   * Загрузка механиков по фактическому исполнителю.
   *
   * Было: Array.from({length: 1..3}) и раздача заявок по остатку индекса от
   * трёх — то есть выдуманные механики с выдуманной загрузкой, все под
   * подписью «Исполнитель не назначен». Настоящий assigneeId в записи есть и
   * приходит с сервера; имена берём из справочника участников.
   */
  const actorById = new Map((props.bootstrap?.selectors.actors ?? []).map((actor) => [actor.id, actor]));
  const workloadByMechanic = (() => {
    const groups = new Map<string, { name: string; records: MaintenanceSummary[] }>();
    for (const record of open) {
      const key = record.assigneeId ?? '__unassigned';
      const name = record.assigneeId
        ? actorById.get(record.assigneeId)?.name ?? record.performedBy ?? 'Исполнитель вне справочника'
        : 'Не назначен';
      const bucket = groups.get(key) ?? { name, records: [] };
      bucket.records.push(record);
      groups.set(key, bucket);
    }
    return [...groups.entries()]
      .map(([id, group]) => ({ id, ...group }))
      .sort((left, right) => right.records.length - left.records.length);
  })();
  const busiest = Math.max(1, ...workloadByMechanic.map((group) => group.records.length));
  const closedRecords = props.maintenance.filter((record) => record.status === 'DONE');
  /** Запчасти — из реально израсходованного (partsUsedText), а не из списка в коде. */
  const partsUsed = props.maintenance
    .flatMap((record) => (record.partsUsedText ?? '')
      .split(/[,;\n]/)
      .map((part) => part.trim())
      .filter(Boolean))
    .reduce((acc, part) => acc.set(part, (acc.get(part) ?? 0) + 1), new Map<string, number>());
  const displayedMaintenance = props.maintenance.filter((record) => {
    if (maintenanceFilter === 'CRITICAL' && !['CRITICAL', 'HIGH'].includes(record.priority)) return false;
    if (maintenanceFilter === 'ACTIVE' && !['IN_PROGRESS', 'ASSIGNED'].includes(record.status)) return false;
    if (maintenanceFilter === 'PLANNED' && !['PLANNED', 'ASSIGNED'].includes(record.status)) return false;
    const query = maintenanceQuery.trim().toLocaleLowerCase('ru-RU');
    return !query || record.title.toLocaleLowerCase('ru-RU').includes(query) || record.equipment?.name.toLocaleLowerCase('ru-RU').includes(query);
  });

  return (
    <>
      <ScreenTitle heading="Обслуживание" subtitle="Техническое состояние и план работ" actions={<div className="flex flex-wrap gap-2"><Button asChild className="min-h-11 bg-signal-strong hover:bg-signal-strong"><Link href="/admin/maintenance">+ Создать заявку</Link></Button></div>} />
      <section className={COMPACT_KPI_GRID} style={kpiGridStyle(4)}>
        <RefKpi icon="defect" label="Критические дефекты" tone="danger" value={blockingDefects.length} detail={`открытых замечаний: ${openDefects.length}`} alert={blockingDefects.length > 0} />
        <RefKpi icon="work-order" label="Работы сегодня" tone="warning" value={todayWork.length} />
        <RefKpi icon="maintenance-due" label="Ближайшие ТО" tone="info" value={planned.length} />
        <RefKpi icon="technical-readiness" label="Готовность сервиса" tone="success" value={`${Math.max(0, servicePercent)}%`} />
      </section>
      <div className="mt-2">
        <DefectsPanel {...props} />
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className={cn(card, 'p-3')}>
          <h2 className="font-bold">Заявки и работы</h2>
          <div className="mt-3 flex flex-wrap gap-2">{([['ALL', 'Все'], ['CRITICAL', 'Критические'], ['ACTIVE', 'В работе'], ['PLANNED', 'Плановые']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={maintenanceFilter === value} onClick={() => setMaintenanceFilter(value)} className={cn('min-h-11 rounded border px-3 text-xs', maintenanceFilter === value ? 'border-signal bg-signal/10 text-signal-strong' : 'border-border text-muted-foreground')}>{label}</button>)}<div className="relative min-w-[220px] flex-1 xl:ml-auto xl:max-w-64"><Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Поиск по обслуживанию" value={maintenanceQuery} onChange={(event) => setMaintenanceQuery(event.target.value)} placeholder="Поиск по технике или заявке" className="min-h-11 bg-muted pl-9 text-xs" /></div></div>
          <div className="mt-2 max-h-[364px] space-y-2 overflow-y-auto pr-1">
            {displayedMaintenance.length > 0 ? displayedMaintenance.slice(0, 8).map((record, index) => {
              const fleet = record.equipment ? props.fleetCards.find((item) => item.id === record.equipment?.id) : undefined;
              const criticalRecord = ['CRITICAL', 'HIGH'].includes(record.priority);
              return (
                <article key={record.id} className={cn('flex min-h-[86px] flex-wrap items-center gap-3 rounded-lg border-l-[3px] p-2.5 sm:flex-nowrap', criticalRecord ? 'border-y border-r border-destructive/25 border-l-destructive bg-destructive/10' : index % 2 ? 'border-y border-r border-info/25 border-l-info bg-info/10' : 'border-y border-r border-signal/25 border-l-signal bg-signal/10')}>
                  <EquipmentPhoto cardData={fleet} name={record.equipment?.name || record.title} className="h-14 w-14 shrink-0" />
                  <span className={cn('grid h-9 w-9 place-items-center rounded-full', criticalRecord ? 'bg-destructive/10 text-destructive-strong' : 'bg-card text-signal-strong')}>{criticalRecord ? <AlertTriangle className="h-5 w-5" /> : <Wrench className="h-5 w-5" />}</span>
                  <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-bold">{record.title}</h3><div className="mt-0.5 text-2xs text-muted-foreground">{record.equipment?.name || 'Установка не указана'}</div><div className="mt-0.5 line-clamp-1 text-2xs text-muted-foreground">{record.description || 'Описание не заполнено'}</div><div className="mt-1 text-3xs text-muted-foreground">▣ {record.scheduledAt ? formatDateTimeInTimezone(record.scheduledAt, props.bootstrap?.tenant.timezone) : 'Срок не задан'}</div></div>
                  <div className="w-full text-left text-2xs sm:w-36 sm:text-right"><div className={cn('font-semibold', criticalRecord ? 'text-destructive-strong' : 'text-info-strong')}>{criticalRecord ? 'Критическое' : STATUS_LABEL[record.status as MaintenanceStatus] ?? record.status}</div><div className="mt-1 text-muted-foreground">Приоритет · <b className="text-muted-foreground">{PRIORITY_LABEL[record.priority as MaintenancePriority] ?? record.priority}</b></div><Button asChild className="mt-2 h-8 bg-signal-strong text-2xs hover:bg-signal-strong"><Link href={`/admin/maintenance/${record.id}`}>Открыть заявку</Link></Button></div>
                </article>
              );
            }) : <div className="py-20 text-center text-sm text-muted-foreground">Заявки обслуживания отсутствуют.</div>}
          </div>
        </section>
        <aside className="space-y-3">
          <section className={cn(card, 'p-3')}>
            <h2 className="font-bold">Сервисный план по моточасам</h2>
            {/*
              Раньше строки шли в произвольном порядке и у каждой стоял один и
              тот же значок «⚠» — срочность не читалась. Сортируем по остатку до
              ТО и показываем полосу пробега: красная у перепробега, оранжевая
              на подходе, зелёная в норме.
            */}
            <div className="mt-2 divide-y divide-border">
              {props.equipment
                .map((item) => ({
                  item,
                  left: item.nextMaintenanceAtHours != null
                    ? item.nextMaintenanceAtHours - (item.engineHoursTotal ?? 0)
                    : null,
                }))
                .sort((left, right) => (left.left ?? Number.POSITIVE_INFINITY) - (right.left ?? Number.POSITIVE_INFINITY))
                .slice(0, 5)
                .map(({ item, left }) => {
                  const overdue = left != null && left <= 0;
                  const soon = left != null && left > 0 && left <= MAINTENANCE_SOON_HOURS;
                  const progress = left != null && item.nextMaintenanceAtHours
                    ? Math.min(100, Math.max(0, (item.engineHoursTotal ?? 0) / item.nextMaintenanceAtHours * 100))
                    : 0;
                  return (
                    <div key={item.id} className="flex items-center gap-2 py-2">
                      <EquipmentPhoto cardData={props.fleetCards.find((entry) => entry.id === item.id)} name={item.name} className="h-8 w-8 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-2xs font-semibold">{item.name}</div>
                        <div className={cn('text-3xs', overdue ? 'font-semibold text-destructive-strong' : soon ? 'font-semibold text-signal-strong' : 'text-muted-foreground')}>
                          {left == null
                            ? 'Регламент не задан'
                            : overdue ? `Перепробег ${Math.abs(left).toLocaleString('ru-RU')} м/ч` : `ТО через ${left.toLocaleString('ru-RU')} м/ч`}
                        </div>
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-border">
                          <div className={cn('h-full rounded-full', overdue ? 'bg-destructive-strong' : soon ? 'bg-signal' : 'bg-success-strong')} style={{ width: `${progress}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
            <Button asChild variant="outline" className="mt-2 h-8 w-full text-2xs"><Link href="/admin/maintenance"><CalendarClock className="mr-2 h-4 w-4" />Открыть календарь</Link></Button>
          </section>
          {/*
            Список запчастей был захардкожен четырьмя названиями с подписью
            «Наличие не учтено» — то есть выдуман целиком. Склада в системе нет,
            но в заявке есть partsUsedText: показываем то, что реально
            расходовали, с числом упоминаний. Пусто — так и пишем.
          */}
          <section className={cn(card, 'p-3')}>
            <div className="flex items-center justify-between"><h2 className="font-bold">Израсходованные запчасти</h2><span className="text-3xs text-muted-foreground">по заявкам</span></div>
            {partsUsed.size > 0 ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {[...partsUsed.entries()].sort((left, right) => right[1] - left[1]).slice(0, 6).map(([part, count]) => (
                  <div key={part} className="rounded-lg border border-border p-2">
                    <div className="line-clamp-2 text-3xs font-semibold">{part}</div>
                    <div className="mt-1 text-3xs text-muted-foreground">упоминаний: {count}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 rounded-lg border border-border p-3 text-3xs leading-relaxed text-muted-foreground">
                В закрытых заявках расход запчастей не заполнен. Складского учёта в системе нет — список появится, когда механики начнут указывать израсходованное в заявке.
              </p>
            )}
          </section>
        </aside>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className={cn(card, 'p-3')}>
          <div className="flex items-center justify-between"><div><h2 className="font-bold">Загрузка механиков</h2><p className="mt-1 text-xs text-muted-foreground">Распределение открытых заявок между исполнителями</p></div><span className="text-xs text-muted-foreground">{open.length} работ в очереди</span></div>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
            {workloadByMechanic.slice(0, 3).map((group) => {
              // Доля относительно самого загруженного исполнителя — это
              // сравнение между людьми, а не выдуманный процент от нормы.
              const share = Math.round(group.records.length / busiest * 100);
              const unassigned = group.id === '__unassigned';
              return (
                <article key={group.id} className={cn('rounded-lg border p-2', unassigned ? 'border-warning/40 bg-warning/5' : 'border-border')}>
                  <div className="flex items-center gap-2">
                    <span className={cn('grid h-9 w-9 place-items-center rounded-full', unassigned ? 'bg-warning/10 text-warning-strong' : 'bg-signal/10 text-signal-strong')}>
                      {unassigned ? <AlertTriangle className="h-5 w-5" /> : <Wrench className="h-5 w-5" />}
                    </span>
                    <div className="min-w-0">
                      <h3 className="truncate text-xs font-bold">{group.name}</h3>
                      <p className="text-3xs text-muted-foreground">{group.records.length} заявок</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2"><div className="h-2 flex-1 overflow-hidden rounded-full bg-border"><div className={cn('h-full rounded-full', unassigned ? 'bg-warning-strong' : 'bg-signal')} style={{ width: `${share}%` }} /></div><b className="text-3xs tabular-nums">{share}%</b></div>
                  <div className="mt-3 space-y-1 text-3xs text-muted-foreground">{group.records.slice(0, 2).map((record) => <div key={record.id} className="truncate">• {record.title}</div>)}</div>
                </article>
              );
            })}
            {workloadByMechanic.length === 0 && (
              <p className="py-6 text-center text-xs text-muted-foreground md:col-span-3">Открытых заявок нет.</p>
            )}
          </div>
        </section>
        <section className={cn(card, 'p-3')}>
          {/*
            Четыре плитки показывали «Нет подтверждения» всегда, а счётчик рядом
            считал закрытые заявки — величины между собой не связаны. Считаем по
            фактическим полям записи: описание работ, приёмка, дата закрытия.
          */}
          <div className="flex items-center justify-between"><h2 className="font-bold">Доказательства выполнения</h2><span className="text-xs text-muted-foreground">{closedRecords.length} закрытых заявок</span></div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {([
              ['Работы описаны', 'documents' as PilingIconName, closedRecords.filter((record) => (record.workDone ?? '').trim() !== '').length],
              ['Расход запчастей', 'work-order' as PilingIconName, closedRecords.filter((record) => (record.partsUsedText ?? '').trim() !== '').length],
              ['Дата закрытия', 'history' as PilingIconName, closedRecords.filter((record) => record.completedAt).length],
              ['Работа принята', 'accepted' as PilingIconName, closedRecords.filter((record) => record.acceptedAt).length],
            ] as const).map(([label, icon, count]) => {
              const complete = closedRecords.length > 0 && count === closedRecords.length;
              return (
                <div key={label} className="rounded-lg border border-border p-2">
                  <div className="flex items-center gap-2"><span className={cn('grid h-7 w-7 place-items-center rounded', complete ? 'bg-success/10 text-success-strong' : 'bg-info/10 text-info-strong')}><PilingIcon name={icon} size={11} decorative /></span><span className="min-w-0 flex-1 text-3xs font-semibold">{label}</span></div>
                  <span className={cn('mt-1 block text-3xs font-semibold', complete ? 'text-success-strong' : 'text-muted-foreground')}>
                    {closedRecords.length === 0 ? 'закрытых заявок нет' : `${count} из ${closedRecords.length}`}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}
