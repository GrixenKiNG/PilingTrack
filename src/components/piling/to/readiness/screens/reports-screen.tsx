'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Search } from '@/components/piling/icons/unified-icons';
import { COMPACT_KPI_GRID, ScreenTitle, card } from '../settings/shared-ui';
import { pluralizeRu } from '@/lib/format';
import { auditActionLabel, isCriticalAuditAction } from '../settings/audit-labels';
import { kpiGridStyle } from '@/components/piling/kpi-tile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDateTimeInTimezone } from '@/lib/timezone';
import { cn } from '@/lib/utils';
import { READINESS_READY_THRESHOLD } from '@/modules/readiness';
import type { ReadinessShiftDto } from '../api/contracts';
import { type ReadinessUrlFilters } from '../api/client';
import { RefKpi, downloadReadinessExport } from './shared';
import type { ReferenceUiProps } from './types';

/** Период отчёта по умолчанию, если фильтр дат не задан. */
const REPORT_DEFAULT_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * Календарный день тенанта для момента времени, «ГГГГ-ММ-ДД».
 *
 * Границы периода считаем днями тенанта, а не мгновениями по часам браузера.
 * Раньше здесь стоял `new Date('2026-07-13T00:00:00')` — это полночь у того,
 * кто смотрит. Сервер при этом разбирает те же даты в поясе тенанта
 * (`parseReadinessReadFilters`), и у пользователя не в Москве серверная
 * выборка и клиентский отбор разъезжались на сутки по краям окна.
 */
const tenantDay = (value: Date | string, timezone: string): string =>
  new Date(value).toLocaleDateString('en-CA', { timeZone: timezone });

/** День как UTC-полночь: арифметика по календарю, без перевода часов. */
const dayToUtc = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

const shiftDay = (day: string, delta: number): string =>
  new Date(dayToUtc(day).getTime() + delta * DAY_MS).toISOString().slice(0, 10);

/** Дата тенанта человеку. Формат в UTC — день уже календарный, сдвигать нечего. */
const formatTenantDay = (day: string): string =>
  new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeZone: 'UTC' }).format(dayToUtc(day));

/**
 * Окно отчёта и равное ему предыдущее окно — для сравнений «к предыдущему
 * периоду». Сравнивать не с чем, если в прошлом окне данных нет: тогда дельту
 * не показываем вовсе, а не рисуем ноль или прочерк со стрелкой.
 */
function resolveReportPeriod(filters: ReadinessUrlFilters, timezone: string) {
  const toDay = filters.to || tenantDay(new Date(), timezone);
  const fromDay = filters.from || shiftDay(toDay, -(REPORT_DEFAULT_DAYS - 1));
  const days = Math.max(
    1,
    Math.round((dayToUtc(toDay).getTime() - dayToUtc(fromDay).getTime()) / DAY_MS) + 1,
  );
  return {
    fromDay,
    toDay,
    days,
    previousFromDay: shiftDay(fromDay, -days),
    previousToDay: shiftDay(fromDay, -1),
  };
}

const average = (values: readonly number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

/**
 * Подпись дельты: знак, единица и оговорка про базу сравнения. Единица
 * необязательна — у счётчиков её нет, иначе выходит «+12 к к предыдущему».
 */
function deltaDetail(current: number | null, previous: number | null, unit?: string): string | undefined {
  if (current == null || previous == null) return undefined;
  const diff = Math.round((current - previous) * 10) / 10;
  if (diff === 0) return 'без изменений к предыдущему периоду';
  return `${diff > 0 ? '+' : '−'}${Math.abs(diff)}${unit ? ` ${unit}` : ''} к предыдущему периоду`;
}

export function ReportsScreen(props: ReferenceUiProps) {
  const [reportPeriod, setReportPeriod] = useState<'day' | 'week'>('day');
  const [fleetMetric, setFleetMetric] = useState<'readiness' | 'usage'>('readiness');
  const states = Object.values(props.readinessByEquipment);
  const authoritative = props.currentReadiness.length > 0 ? props.currentReadiness : null;
  const ready = authoritative
    ? authoritative.filter((item) => item.status === 'READY').length
    : states.filter((item) => item.canOperate).length;
  const readinessPercent = authoritative?.length
    ? Math.round(authoritative.reduce((sum, item) => sum + item.score, 0) / authoritative.length * 10) / 10
    : states.length ? Math.round(ready / states.length * 1000) / 10 : 0;
  const timezone = props.bootstrap?.tenant.timezone ?? 'Europe/Moscow';
  const period = resolveReportPeriod(props.filters, timezone);
  // Сравнение строк «ГГГГ-ММ-ДД» — то же, что сравнение календарных дней.
  const within = (value: string | null | undefined, first: string, last: string) => {
    if (!value) return false;
    const time = new Date(value).getTime();
    if (!Number.isFinite(time)) return false;
    const day = tenantDay(value, timezone);
    return day >= first && day <= last;
  };
  const inPeriod = (value: string | null | undefined) => within(value, period.fromDay, period.toDay);
  const inPrevious = (value: string | null | undefined) =>
    within(value, period.previousFromDay, period.previousToDay);

  /**
   * Итог допуска считаем по самим сменам, а не по установкам: у смены есть
   * `requestedAt`, `startedAt` и `declinedAt`, то есть решение диспетчера
   * зафиксировано временем. Раньше кольцо «Результат допуска» строилось из
   * conic-gradient по среднему БАЛЛУ готовности, а подписи рядом считали
   * УСТАНОВКИ — геометрия кольца и числа под ним не имели отношения друг к другу.
   */
  const admitted = props.shifts.filter((shift) => inPeriod(shift.startedAt));
  const admittedPrevious = props.shifts.filter((shift) => inPrevious(shift.startedAt));
  const refused = props.shifts.filter((shift) => inPeriod(shift.declinedAt));
  const refusedPrevious = props.shifts.filter((shift) => inPrevious(shift.declinedAt));
  const awaiting = props.shifts.filter((shift) => shift.state === 'PENDING_ACCEPTANCE');
  const decidedTotal = admitted.length + refused.length + awaiting.length;

  /** Сколько диспетчер думает над допуском: от запроса до решения. */
  const decisionMinutes = (shifts: readonly ReadinessShiftDto[]) => shifts.flatMap((shift) => {
    const decidedAt = shift.startedAt ?? shift.declinedAt;
    if (!shift.requestedAt || !decidedAt) return [];
    const minutes = (new Date(decidedAt).getTime() - new Date(shift.requestedAt).getTime()) / 60_000;
    return Number.isFinite(minutes) && minutes >= 0 ? [minutes] : [];
  });
  const decisionNow = average(decisionMinutes([...admitted, ...refused]));
  const decisionBefore = average(decisionMinutes([...admittedPrevious, ...refusedPrevious]));

  const periodSnapshots = props.readinessHistory.filter((snapshot) => inPeriod(snapshot.calculatedAt));
  const previousScore = average(props.readinessHistory
    .filter((snapshot) => inPrevious(snapshot.calculatedAt))
    .map((snapshot) => snapshot.score));
  const periodAudit = (props.audit?.data ?? []).filter((event) => inPeriod(event.occurredAt));
  const evidenceCount = periodSnapshots.length + periodAudit.length;

  /** Занятость установки: доля суток периода, в которые смена дошла до работы. */
  const usageByEquipment = new Map<string, number>();
  for (const shift of admitted) {
    const day = shift.productionDate.slice(0, 10);
    const key = `${shift.equipmentId}:${day}`;
    if (!usageByEquipment.has(key)) usageByEquipment.set(key, 1);
  }
  const usageDays = (equipmentId: string) =>
    [...usageByEquipment.keys()].filter((key) => key.startsWith(`${equipmentId}:`)).length;

  // Список по установкам — из авторитетных снимков, как и плитки наверху.
  // Производная модель заполнена не для всех установок, и раньше строка парка
  // бралась именно из неё; заодно `.slice(0, 5)` молча прятал остальные.
  const fleetRows = props.equipment.map((item) => {
    const authority = props.currentReadiness.find((row) => row.equipmentId === item.id);
    const score = authority?.score ?? props.readinessByEquipment[item.id]?.score ?? null;
    const days = usageDays(item.id);
    return {
      id: item.id,
      name: item.name,
      score,
      usage: period.days > 0 ? Math.round(days / period.days * 100) : 0,
      usageDays: days,
    };
  }).sort((left, right) => fleetMetric === 'usage'
    ? right.usage - left.usage
    : (right.score ?? -1) - (left.score ?? -1));

  /**
   * Разворачиваем идентификатор записи аудита в установку и объект.
   *
   * Раньше в колонке «Установка» стоял `event.entity.type` — то есть строка
   * «WorkPermit» или «Shift» вместо названия техники, а в «Событии» — сырой код
   * действия. Сама колонка «Тип» показывала внутренние `READINESS_SNAPSHOT` и
   * `AUDIT_DECISION`, потому что прогонялась через словарь типов ТО, где таких
   * ключей нет.
   */
  const equipmentByEntity = new Map<string, string>();
  for (const shift of props.shifts) {
    equipmentByEntity.set(shift.id, shift.equipmentId);
    for (const handover of shift.handovers) equipmentByEntity.set(handover.id, shift.equipmentId);
  }
  for (const permit of props.permits) equipmentByEntity.set(permit.id, permit.equipmentId);
  const siteByEquipment = new Map(props.fleetCards.map((card) => [card.id, card.assignedSiteName ?? null]));
  const nameByEquipment = new Map(props.equipment.map((item) => [item.id, item.name]));

  const snapshotRows = periodSnapshots.map((snapshot) => ({
    id: snapshot.id,
    at: snapshot.calculatedAt,
    event: 'Снимок готовности',
    equipmentId: snapshot.equipmentId,
    actor: 'Система',
    outcome: snapshot.status === 'READY'
      ? { label: 'Готово', tone: 'success' as const }
      : { label: 'Заблокировано', tone: 'danger' as const },
  }));
  const decisionRows = periodAudit
    .filter((event) => ['WorkPermit', 'ShiftHandover', 'Shift'].includes(event.entity.type))
    .map((event) => ({
      id: event.id,
      at: event.occurredAt,
      event: auditActionLabel(event.action),
      equipmentId: equipmentByEntity.get(event.entity.id) ?? null,
      actor: event.actor.name || 'Система',
      outcome: isCriticalAuditAction(event.action)
        ? { label: 'Критично', tone: 'danger' as const }
        : { label: 'Зафиксировано', tone: 'info' as const },
    }));
  const journalRows = [...snapshotRows, ...decisionRows]
    .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());
  /**
   * Причины блокировки — по фактам авторитетных снимков.
   *
   * Считались по производной модели: item.evidence.find(...)?.state !== 'pass'.
   * Доказательства в ней заполнены только для выбранной установки (журнал ТО
   * грузится по одной), поэтому у остальных find возвращал undefined и условие
   * «!== pass» срабатывало всегда — Парето показывал почти весь парк в каждой
   * причине. Ключа 'crew' среди доказательств вообще нет, эта строка была
   * равна общему числу установок при любых данных.
   */
  const facts = props.currentReadiness.flatMap((item) => item.facts ? [item.facts] : []);
  const blockerRows: Array<readonly [string, number]> = [
    ['Критический дефект', facts.filter((item) => item.criticalDefect).length],
    ['Осмотр не завершён', facts.filter((item) => !item.inspectionCompleted).length],
    ['Наряд-допуск', facts.filter((item) => item.permitValid === false || item.permitExpired).length],
    ['Просрочено ТО', facts.filter((item) => item.maintenanceOverdueHours > 0 || item.maintenanceOverdueDays > 0).length],
    ['Приёмка не подтверждена', facts.filter((item) => !item.accepted).length],
  ];
  blockerRows.sort((left, right) => right[1] - left[1]);
  const maxBlocker = Math.max(1, ...blockerRows.map(([, value]) => value));
  const dailyTrend = Object.entries(periodSnapshots.reduce<Record<string, number[]>>((result, snapshot) => {
    const day = tenantDay(snapshot.calculatedAt, timezone);
    // Неделя начинается с понедельника: getUTCDay() отдаёт 0 для воскресенья.
    const weekday = (dayToUtc(day).getUTCDay() + 6) % 7;
    const bucket = reportPeriod === 'week' ? shiftDay(day, -weekday) : day;
    (result[bucket] ??= []).push(snapshot.score);
    return result;
  }, {})).sort(([left], [right]) => left.localeCompare(right)).map(([day, scores]) => ({
    day,
    score: Math.round(average(scores) ?? 0),
  }));
  const trendX = (index: number) => dailyTrend.length === 1 ? 300 : index / (dailyTrend.length - 1) * 600;
  const trendY = (score: number) => 200 - score * 2;
  const trendPoints = dailyTrend.map((item, index) => `${trendX(index)},${trendY(item.score)}`).join(' ');

  // Кумулятивная кривая Парето: доля, которую набирают причины слева направо.
  const blockerTotal = blockerRows.reduce((sum, [, value]) => sum + value, 0);
  let blockerRunning = 0;
  const paretoRows = blockerRows.map(([label, value]) => {
    blockerRunning += value;
    return { label, value, cumulative: blockerTotal > 0 ? Math.round(blockerRunning / blockerTotal * 100) : 0 };
  });

  return (
    <>
      <ScreenTitle
        heading="Отчёты"
        subtitle="Аналитика доказательной готовности"
        actions={(
          <Button className="bg-signal-strong hover:bg-signal-strong" onClick={() => void downloadReadinessExport('reports', props.filters).catch((error) => toast.error(error instanceof Error ? error.message : 'Не удалось сформировать экспорт'))}>
            Экспорт отчёта
          </Button>
        )}
      />
      {/*
        Границы периода печатаем словами: фильтр дат рисует общая полоса над
        экраном, но пустые поля в ней читаются как «фильтра нет», а не как
        «последние 30 суток». Раньше вместо периода стояла подпись «текущий
        срез», и заголовок «за 30 дней» ничем не подкреплялся.
      */}
      <p className="mb-2 text-2xs text-muted-foreground">
        Период: {formatTenantDay(period.fromDay)} — {formatTenantDay(period.toDay)}
        {' · '}{period.days} {pluralizeRu(period.days, ['сутки', 'суток', 'суток'])}
      </p>
      <section className={COMPACT_KPI_GRID} style={kpiGridStyle(5)}>
        <RefKpi
          icon="technical-readiness"
          label="Готовность парка"
          tone="success"
          value={`${readinessPercent}%`}
          detail={deltaDetail(readinessPercent, previousScore, 'п.п.') ?? 'сравнить не с чем'}
        />
        {/*
          Было «Смен допущено» со значением ready — это количество ГОТОВЫХ
          УСТАНОВОК, а не допущенных смен. Считаем смены, реально дошедшие до
          запуска, а установки называем установками.
        */}
        <RefKpi
          icon="shift-start"
          label="Смен допущено"
          tone="info"
          value={admitted.length}
          detail={deltaDetail(admitted.length, admittedPrevious.length) ?? 'дошли до работы'}
        />
        <RefKpi
          icon="defect"
          label="Отказано в допуске"
          tone="danger"
          value={refused.length}
          alert={refused.length > 0}
          detail={deltaDetail(refused.length, refusedPrevious.length) ?? 'решений диспетчера'}
        />
        {/*
          «Среднее решение» вернулось: у смены есть requestedAt и время решения
          (startedAt либо declinedAt), так что интервал считается по фактам.
          Раньше плитка стояла с прочерком и подписью «нет истории решений».
        */}
        <RefKpi
          icon="history"
          label="Среднее решение"
          tone="info"
          value={decisionNow == null ? '—' : `${Math.round(decisionNow)} мин`}
          detail={decisionNow == null
            ? 'нет решений с запросом допуска'
            : deltaDetail(decisionNow, decisionBefore, 'мин') ?? 'от запроса до решения'}
        />
        <RefKpi icon="documents" label="Доказательств" tone="info" value={evidenceCount} detail="снимки и решения за период" />
      </section>
      <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
        <section className={cn(card, 'p-3')}>
          <div className="flex items-center justify-between"><h2 className="font-bold">Динамика готовности за 30 дней</h2><div className="flex overflow-hidden rounded border border-border"><button type="button" aria-pressed={reportPeriod === 'day'} onClick={() => setReportPeriod('day')} className={cn('min-h-11 px-3 text-xs', reportPeriod === 'day' && 'bg-signal-strong text-white')}>День</button><button type="button" aria-pressed={reportPeriod === 'week'} onClick={() => setReportPeriod('week')} className={cn('min-h-11 px-3 text-xs', reportPeriod === 'week' && 'bg-signal-strong text-white')}>Неделя</button></div></div>
          <div className="mt-3 flex gap-2">
            <div className="flex w-8 shrink-0 flex-col justify-between py-0.5 text-right text-3xs text-muted-foreground">
              {[100, 90, 80, 70, 60].map((value) => <span key={value}>{value}%</span>)}
            </div>
            <div className="relative h-[150px] min-w-0 flex-1 border-b border-l border-border">
              {[0, 1, 2, 3].map((line) => <div key={line} className="absolute inset-x-0 border-t border-dashed border-border" style={{ top: `${line * 25}%` }} />)}
              {/* Целевой уровень — тот же порог, по которому модуль считает установку готовой. */}
              <div
                className="absolute inset-x-0 border-t-2 border-dashed border-success/60"
                style={{ top: `${(100 - READINESS_READY_THRESHOLD) / 40 * 100}%` }}
              />
              {trendPoints ? (
                <svg viewBox="0 0 600 200" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" role="img" aria-label={`Динамика средней готовности, ${dailyTrend.length} точек`}>
                  <polyline points={trendPoints} fill="none" stroke="var(--signal)" strokeWidth="3" vectorEffect="non-scaling-stroke" />
                  {dailyTrend.map((item, index) => (
                    <circle
                      key={item.day}
                      cx={trendX(index)}
                      cy={trendY(item.score)}
                      r="4"
                      vectorEffect="non-scaling-stroke"
                      fill={item.score >= READINESS_READY_THRESHOLD ? 'var(--success-strong)' : 'var(--destructive-strong)'}
                    />
                  ))}
                </svg>
              ) : (
                <div className="absolute inset-0 grid place-items-center px-4 text-center text-xs text-muted-foreground">
                  За выбранный период снимков готовности нет.
                </div>
              )}
              <div className="absolute right-3 top-3 rounded border border-border bg-card px-3 py-2 text-xs"><b>{readinessPercent}%</b><br /><span className="text-muted-foreground">сегодня</span></div>
            </div>
          </div>
          {dailyTrend.length > 0 && (
            <div className="mt-1 flex justify-between pl-10 text-3xs text-muted-foreground">
              <span>{formatTenantDay(dailyTrend[0].day)}</span>
              <span>{formatTenantDay(dailyTrend[dailyTrend.length - 1].day)}</span>
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-4 border-t border-border pt-2 text-3xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-0.5 w-4 bg-signal-strong" />Средняя готовность</span>
            <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-0 w-4 border-t-2 border-dashed border-success/60" />Целевой уровень {READINESS_READY_THRESHOLD}%</span>
          </div>
        </section>
        <section className={cn(card, 'p-3')}>
          <h2 className="font-bold">Причины блокировки · Парето</h2>
          {blockerTotal === 0 ? (
            <p className="mt-6 text-center text-xs text-muted-foreground">Ни одна причина сейчас не срабатывает.</p>
          ) : (
            <>
              <div className="mt-4 space-y-3">
                {paretoRows.map((row, index) => (
                  <div key={row.label} className="grid grid-cols-[130px_minmax(0,1fr)_28px_44px] items-center gap-3 text-xs">
                    <span className="truncate text-right" title={row.label}>{row.label}</span>
                    <div className="h-4 overflow-hidden bg-muted">
                      <div className={cn('h-full', index === 0 ? 'bg-destructive-strong' : 'bg-signal-strong')} style={{ width: `${row.value / maxBlocker * 100}%` }} />
                    </div>
                    <b className="text-right">{row.value}</b>
                    {/* Кумулятивный процент — вторая ось диаграммы Парето: где набирается 80%. */}
                    <span className="text-right font-mono text-3xs text-info-strong">{row.cumulative}%</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-border pt-2 text-3xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-2 bg-destructive-strong" />Количество блокировок</span>
                <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-2 bg-info-strong" />Накопленная доля</span>
              </div>
            </>
          )}
        </section>
        <section className={cn(card, 'p-3')}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold">{fleetMetric === 'usage' ? 'Использование установок' : 'Готовность по установкам'}</h2>
            <div className="flex overflow-hidden rounded border border-border">
              <button type="button" aria-pressed={fleetMetric === 'readiness'} onClick={() => setFleetMetric('readiness')} className={cn('min-h-11 px-3 text-xs', fleetMetric === 'readiness' && 'bg-signal-strong text-white')}>Готовность</button>
              <button type="button" aria-pressed={fleetMetric === 'usage'} onClick={() => setFleetMetric('usage')} className={cn('min-h-11 px-3 text-xs', fleetMetric === 'usage' && 'bg-signal-strong text-white')}>Использование</button>
            </div>
          </div>
          {/*
            Показываем весь парк, а не первые пять: `.slice(0, 5)` молча прятал
            остальные установки. Пилюля раньше всегда была зелёной, даже когда
            подпись на ней читалась «Средняя», и уровня «Низкая» не было вовсе.
          */}
          <div className="mt-3 max-h-[240px] space-y-2 overflow-y-auto pr-1">
            {fleetRows.map((row) => {
              const value = fleetMetric === 'usage' ? row.usage : row.score;
              const level = value == null ? null : value >= READINESS_READY_THRESHOLD ? 'high' : value >= 60 ? 'mid' : 'low';
              return (
                <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_44px_74px] items-center gap-2 text-2xs">
                  <span className="truncate font-semibold" title={row.name}>{row.name}</span>
                  <div className="h-2 overflow-hidden rounded-full bg-border">
                    <div
                      className={cn('h-full rounded-full', level === 'high' ? 'bg-success-strong' : level === 'mid' ? 'bg-signal-strong' : 'bg-destructive-strong')}
                      style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }}
                    />
                  </div>
                  <b className="text-right font-mono">{value == null ? '—' : `${value}%`}</b>
                  {fleetMetric === 'usage'
                    ? <span className="text-right text-3xs text-muted-foreground">{row.usageDays} {pluralizeRu(row.usageDays, ['смена', 'смены', 'смен'])}</span>
                    : (
                      <span className={cn('rounded px-2 py-1 text-center text-3xs font-semibold',
                        level === 'high' ? 'bg-success/10 text-success-strong'
                          : level === 'mid' ? 'bg-warning/10 text-warning-strong'
                            : level === 'low' ? 'bg-destructive/10 text-destructive-strong'
                              : 'bg-muted text-muted-foreground')}>
                        {level === 'high' ? 'Высокая' : level === 'mid' ? 'Средняя' : level === 'low' ? 'Низкая' : 'Нет данных'}
                      </span>
                    )}
                </div>
              );
            })}
            {fleetRows.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">Установок в контуре нет.</p>}
          </div>
        </section>
        <section className={cn(card, 'p-3')}>
          <h2 className="font-bold">Результат допуска</h2>
          {decidedTotal === 0 ? (
            <p className="mt-6 text-center text-xs text-muted-foreground">За выбранный период решений по допуску не было.</p>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-6">
              {/*
                Доли кольца — доли САМИХ решений. Раньше conic-gradient строился
                по среднему баллу готовности, а подписи считали установки:
                геометрия и числа под ней описывали разные величины.
              */}
              <div
                className="relative h-24 w-24 shrink-0 rounded-full"
                style={{ background: `conic-gradient(var(--success-strong) 0 ${admitted.length / decidedTotal * 100}%, var(--warning) ${admitted.length / decidedTotal * 100}% ${(admitted.length + awaiting.length) / decidedTotal * 100}%, var(--destructive-strong) ${(admitted.length + awaiting.length) / decidedTotal * 100}% 100%)` }}
              >
                <div className="absolute inset-3 grid place-items-center rounded-full bg-card text-center">
                  <div>
                    <b className="font-mono text-xl">{decidedTotal}</b>
                    <div className="text-3xs text-muted-foreground">{pluralizeRu(decidedTotal, ['смена', 'смены', 'смен'])}</div>
                  </div>
                </div>
              </div>
              <div className="min-w-[200px] flex-1 space-y-3 text-xs">
                {[
                  { label: 'Допущено', value: admitted.length, dot: 'text-success-strong' },
                  { label: 'Ждут решения', value: awaiting.length, dot: 'text-warning-strong' },
                  { label: 'Отказано', value: refused.length, dot: 'text-destructive-strong' },
                ].map((row) => (
                  <div key={row.label} className="flex items-center gap-2">
                    <span aria-hidden="true" className={row.dot}>●</span>
                    <span className="min-w-0 flex-1">{row.label}</span>
                    <b className="font-mono">{row.value}</b>
                    <span className="w-10 text-right font-mono text-muted-foreground">{Math.round(row.value / decidedTotal * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
      <section className={cn(card, 'mt-2 overflow-x-auto')}>
        <div className="flex flex-wrap items-center justify-between gap-2 p-3">
          <div><h2 className="font-bold">Доказательный журнал</h2><p className="mt-1 text-xs text-muted-foreground">Неизменяемая история решений и подтверждений</p></div>
          <div className="flex flex-wrap gap-2"><div className="relative min-w-[220px] flex-1 sm:w-64"><Search className="absolute left-3 top-2 h-4 w-4 text-muted-foreground" /><Input aria-label="Поиск по доказательному журналу" className="h-8 bg-muted pl-9 text-xs" placeholder="Поиск по установке или событию" /></div><Button variant="outline" className="h-8 text-xs">Фильтры</Button><Button variant="outline" className="h-8 text-xs" onClick={() => { props.onViewChange('settings'); props.onSettingsSectionChange('audit'); }}>Открыть полный журнал</Button></div>
        </div>
        <div className="hidden min-w-[860px] grid-cols-[140px_minmax(0,1.3fr)_170px_150px_150px_110px] border-y border-border bg-muted px-4 py-2 text-3xs uppercase tracking-wide text-muted-foreground md:grid"><span>Время</span><span>Событие</span><span>Установка</span><span>Объект</span><span>Исполнитель</span><span>Результат</span></div>
        <div className="hidden min-w-[860px] divide-y divide-border md:block">
          {journalRows.length > 0 ? journalRows.slice(0, 8).map((record) => (
            <div key={record.id} className="grid grid-cols-[140px_minmax(0,1.3fr)_170px_150px_150px_110px] items-center px-4 py-2 text-2xs">
              <span className="text-muted-foreground">{formatDateTimeInTimezone(record.at, props.bootstrap?.tenant.timezone)}</span>
              <span className="truncate" title={record.event}>{record.event}</span>
              <span className="truncate font-semibold">{record.equipmentId ? nameByEquipment.get(record.equipmentId) ?? '—' : '—'}</span>
              <span className="truncate text-muted-foreground">{record.equipmentId ? siteByEquipment.get(record.equipmentId) || 'не назначен' : '—'}</span>
              <span className="truncate text-muted-foreground">{record.actor}</span>
              <span>
                <span className={cn('rounded px-2 py-1 text-3xs font-semibold',
                  record.outcome.tone === 'success' ? 'bg-success/10 text-success-strong'
                    : record.outcome.tone === 'danger' ? 'bg-destructive/10 text-destructive-strong'
                      : 'bg-info/10 text-info-strong')}>
                  {record.outcome.label}
                </span>
              </span>
            </div>
          )) : <div className="py-10 text-center text-sm text-muted-foreground">За выбранный период записей нет.</div>}
        </div>
        <div className="space-y-2 p-3 md:hidden">
          {journalRows.length > 0 ? journalRows.slice(0, 10).map((record) => (
            <article key={record.id} className="rounded-lg border border-border p-3 text-xs">
              <div className="flex items-start justify-between gap-2">
                <b className="min-w-0">{record.event}</b>
                <span className={cn('shrink-0 rounded px-2 py-1 text-3xs font-semibold',
                  record.outcome.tone === 'success' ? 'bg-success/10 text-success-strong'
                    : record.outcome.tone === 'danger' ? 'bg-destructive/10 text-destructive-strong'
                      : 'bg-info/10 text-info-strong')}>
                  {record.outcome.label}
                </span>
              </div>
              <div className="mt-2 font-medium">{record.equipmentId ? nameByEquipment.get(record.equipmentId) ?? '—' : '—'}</div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-muted-foreground">
                <span>{formatDateTimeInTimezone(record.at, props.bootstrap?.tenant.timezone)}</span>
                <span>{record.actor}</span>
              </div>
            </article>
          )) : <div className="py-8 text-center text-sm text-muted-foreground">За выбранный период записей нет.</div>}
        </div>
      </section>
      {/* Резерв называем только когда есть что называть: при нуле блокировок
          баннер обещал «формирует 0% блокировок». */}
      {paretoRows.length > 0 && paretoRows[0].value > 0 && (
        <section className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-signal/25 bg-signal/10 px-3 py-2">
          <AlertTriangle className="h-5 w-5 shrink-0 text-signal-strong" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-signal-strong">
              Основной резерв готовности: {paretoRows[0].label.toLowerCase()} формирует {Math.round(paretoRows[0].value / blockerTotal * 100)}% блокировок
            </h2>
            <p className="mt-0.5 text-xs text-warning-strong">Приоритетная зона для сокращения простоев и восстановления доступности парка.</p>
          </div>
          <Button variant="outline" className="border-signal text-signal-strong" onClick={() => props.onViewChange('maintenance')}>Перейти к обслуживанию →</Button>
        </section>
      )}
    </>
  );
}
