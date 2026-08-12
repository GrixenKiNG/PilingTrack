'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { COMPACT_KPI_GRID, ScreenTitle, card } from '../settings/shared-ui';
import { kpiGridStyle } from '@/components/piling/kpi-tile';
import { Button } from '@/components/ui/button';
import { authFetch } from '@/lib/api';
import { formatDateInTimezone, getTodayInTimezone } from '@/lib/timezone';
import { cn } from '@/lib/utils';
import { SHIFT_STATE_LABEL } from '../readiness-labels';
import type { ReadinessShiftDto } from '../api/contracts';
import { CommandDialog } from '../shared/command-dialog';
import { EquipmentPhoto, ProcessRoleStrip, RefKpi, commandFailure } from './shared';
import type { ReferenceUiProps } from './types';

function formatTimeInTimezone(value: Date | string, timezone: string) {
  return formatDateInTimezone(value, timezone, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

function decimalHourInTimezone(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  return hour + minute / 60;
}

export function ShiftsScreen(props: ReferenceUiProps) {
  const [period, setPeriod] = useState<'day' | 'week'>('day');
  const [command, setCommand] = useState<{shift: ReadinessShiftDto; action: 'request-acceptance' | 'start' | 'handover' | 'decline'} | null>(null);
  const [reworkTarget, setReworkTarget] = useState<ReadinessShiftDto['handovers'][number] | null>(null);
  const [reworkReason, setReworkReason] = useState('');
  const [commandSummary, setCommandSummary] = useState('');
  const [commandError, setCommandError] = useState<string | null>(null);
  const [commandPending, setCommandPending] = useState(false);
  const activeCrews = props.crews.filter((crew) => crew.isActive);
  const timezone = props.bootstrap?.tenant.timezone ?? 'Europe/Moscow';
  const today = getTodayInTimezone(timezone);
  const weekStart = Date.now() - 6 * 86_400_000;
  const todayShifts = props.shifts.filter((shift) => period === 'day'
    ? shift.productionDate.slice(0, 10) === today
    : new Date(shift.productionDate).getTime() >= weekStart);
  const ready = todayShifts.filter((shift) => shift.state === 'STARTED');
  const waiting = todayShifts.filter((shift) => shift.state === 'HANDOVER_PENDING');
  const blocked = todayShifts.filter((shift) => shift.state === 'CANCELLED');
  const hours = ['06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00'];
  /**
   * Отметка «сейчас» на графике. Была прибита к left-[23%] — не двигалась со
   * временем и в любой час показывала одно и то же место, то есть врала о
   * текущем моменте. Считается от фактического времени в поясе тенанта; ось
   * графика 06:00–22:00, отсюда шкала в 16 часов. Вне этого окна метки нет.
   *
   * Значение ставится в эффекте, а не при рендере: время на сервере и на
   * клиенте разное, и прямой расчёт ломал бы гидратацию.
   */
  const [now, setNow] = useState<{ left: number; label: string } | null>(null);
  useEffect(() => {
    const update = () => {
      const current = new Date();
      const decimal = decimalHourInTimezone(current, timezone);
      setNow(decimal >= 6 && decimal <= 22
        ? { left: (decimal - 6) / 16 * 100, label: formatTimeInTimezone(current, timezone) }
        : null);
    };
    update();
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, [timezone]);
  const createShift = async () => {
    if (!props.selectedId || !props.bootstrap?.capabilities.entities.shift.manage) return;
    const hour = new Date().getHours();
    const response = await authFetch('/api/readiness/shifts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
        ...(props.bootstrap?.actor.actingAs ? { 'x-readiness-acting-as': props.bootstrap.actor.actingAs } : {}),
      },
      body: JSON.stringify({ equipmentId: props.selectedId, type: hour >= 20 || hour < 8 ? 'NIGHT' : 'DAY' }),
    });
    if (!response.ok) return toast.error((await response.json().catch(() => null))?.error?.message ?? 'Не удалось создать смену');
    toast.success('Смена создана');
    props.onRetry();
  };
  const acceptHandover = async (handover: ReadinessShiftDto['handovers'][number]) => {
    const response = await authFetch(`/api/readiness/handovers/${handover.id}/accept`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
        'if-match': `"handover-${handover.id}-v${handover.version}"`,
      },
      body: JSON.stringify({ expectedVersion: handover.version }),
    });
    if (!response.ok) return toast.error((await response.json().catch(() => null))?.error?.message ?? 'Не удалось принять смену');
    toast.success('Передача смены принята');
    props.onRetry();
  };
  /**
   * Возврат пакета оператору. Раньше интерфейс умел только принимать: endpoint
   * существовал, но не вызывался, и диспетчер не мог отказать в приёмке.
   */
  const reworkHandover = async (handover: ReadinessShiftDto['handovers'][number], reason: string) => {
    setCommandPending(true);
    setCommandError(null);
    const response = await authFetch(`/api/readiness/handovers/${handover.id}/rework`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
        'if-match': `"handover-${handover.id}-v${handover.version}"`,
      },
      body: JSON.stringify({ expectedVersion: handover.version, reason: reason.trim() }),
    });
    setCommandPending(false);
    if (!response.ok) {
      setCommandError((await response.json().catch(() => null))?.error?.message ?? 'Не удалось вернуть передачу.');
      return;
    }
    setReworkTarget(null);
    setReworkReason('');
    toast.success('Передача возвращена оператору');
    props.onRetry();
  };
  const runShiftAction = async (shift: ReadinessShiftDto, action: 'request-acceptance' | 'start' | 'handover' | 'decline') => {
    if (action === 'handover' && !commandSummary.trim()) {
      setCommandError('Укажите состояние техники и незавершённые работы.');
      return;
    }
    if (action === 'decline' && commandSummary.trim().length < 3) {
      setCommandError('Укажите, что мешает допустить установку к работе.');
      return;
    }
    setCommandPending(true);
    setCommandError(null);
    const response = await authFetch(`/api/readiness/shifts/${shift.id}/${action}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
        'if-match': `"shift-${shift.id}-v${shift.version}"`,
      },
      body: JSON.stringify(action === 'handover'
        ? { expectedVersion: shift.version, summary: commandSummary.trim() }
        : action === 'decline'
          ? { expectedVersion: shift.version, reason: commandSummary.trim() }
          : { expectedVersion: shift.version }),
    });
    setCommandPending(false);
    if (!response.ok) {
      const message = await commandFailure(response);
      setCommandError(message);
      if (response.status === 409) props.onRetry();
      return;
    }
    toast.success(action === 'start' ? 'Смена запущена'
      : action === 'request-acceptance' ? 'Запрос допуска отправлен диспетчеру'
        : action === 'decline' ? 'В допуске отказано, смена возвращена оператору'
          : 'Смена передана диспетчеру');
    setCommand(null);
    setCommandSummary('');
    props.onRetry();
  };

  return (
    <>
      <ScreenTitle
        heading="Смены"
        subtitle={period === 'day' ? `Сегодня, ${formatDateInTimezone(new Date(), props.bootstrap?.tenant.timezone, {day: 'numeric', month: 'long'})}` : 'Последние 7 дней'}
        actions={<div className="flex flex-wrap items-center gap-2"><div className="flex overflow-hidden rounded-lg border border-border bg-background"><button type="button" aria-pressed={period === 'day'} onClick={() => setPeriod('day')} className={cn('min-h-11 px-5 text-xs font-semibold', period === 'day' && 'bg-signal/10 text-signal-strong')}>День</button><button type="button" aria-pressed={period === 'week'} onClick={() => setPeriod('week')} className={cn('min-h-11 border-l border-border px-5 text-xs', period === 'week' ? 'bg-signal/10 font-semibold text-signal-strong' : 'text-muted-foreground')}>Неделя</button></div><Button type="button" disabled={!props.selectedId || !props.bootstrap?.capabilities.entities.shift.manage} onClick={() => void createShift()} className="min-h-11 bg-signal-strong hover:bg-signal-strong">+ Создать смену</Button></div>}
      />
      <div className="mb-2 flex flex-wrap gap-2 text-2xs text-muted-foreground"><span className="rounded border border-border bg-card px-2 py-1">Дневная 08:00–20:00</span><span className="rounded border border-border bg-card px-2 py-1">Ночная 20:00–08:00</span><span className="rounded border border-border bg-card px-2 py-1">Часовой пояс: {timezone}</span></div>
      <section className={COMPACT_KPI_GRID} style={kpiGridStyle(4)}>
        <RefKpi icon="shift-start" label="Смен сегодня" tone="info" value={todayShifts.length} />
        <RefKpi icon="technical-readiness" label="В работе" tone="success" value={ready.length} />
        <RefKpi icon="operator" label="Ждут приёмки" tone="warning" value={waiting.length} alert={waiting.length > 0} />
        <RefKpi icon="defect" label="Отменены" tone="danger" value={blocked.length} alert={blocked.length > 0} />
      </section>
      <div className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className={cn(card, 'overflow-x-auto p-3')}>
          <h2 className="font-bold">График смен</h2>
          <div className="mt-3 hidden min-w-[760px] grid-cols-[220px_minmax(0,1fr)] md:grid">
            <div />
            <div className="grid grid-cols-9 px-2 text-3xs text-muted-foreground">{hours.map((hour) => <span key={hour}>{hour}</span>)}</div>
          </div>
          <div className="mt-2 hidden min-w-[760px] divide-y divide-border md:block">
            {todayShifts.length > 0 ? todayShifts.slice(0, 8).map((shift, shiftIndex) => {
              const equipment = props.equipment.find((item) => item.id === shift.equipmentId);
              const crew = activeCrews.find((item) => item.equipment?.id === shift.equipmentId);
              const equipmentCard = props.fleetCards.find((item) => item.id === shift.equipmentId);
              const start = shift.plannedStartAt ? new Date(shift.plannedStartAt) : null;
              const end = shift.plannedEndAt ? new Date(shift.plannedEndAt) : null;
              const startHour = start ? decimalHourInTimezone(start, timezone) : shift.type === 'DAY' ? 8 : 20;
              const duration = start && end ? Math.max(1, (end.getTime() - start.getTime()) / 3_600_000) : 8;
              const left = Math.max(0, Math.min(94, (startHour - 6) / 16 * 100));
              const width = Math.max(6, Math.min(100 - left, duration / 16 * 100));
              return (
                <div key={shift.id} className="grid grid-cols-[220px_minmax(0,1fr)] items-center py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <EquipmentPhoto cardData={equipmentCard} name={equipment?.name || 'Установка'} className="h-9 w-9 shrink-0" />
                    <div className="min-w-0 flex-1"><div className="truncate text-2xs font-semibold">{equipment?.name || 'Установка'}</div><div className="mt-0.5 truncate text-3xs text-muted-foreground">{crew?.site?.name || 'Объект не назначен'}</div><div className="truncate text-3xs text-muted-foreground">{shift.type === 'DAY' ? 'Дневная' : 'Ночная'} смена</div>{shift.state === 'PLANNED' && props.bootstrap?.capabilities.entities.shift.manage && <button type="button" onClick={() => { setCommand({shift, action: 'request-acceptance'}); setCommandError(null); }} className="mt-1 min-h-11 rounded border border-signal/30 px-2 text-3xs font-semibold text-signal-strong">Запросить допуск</button>}{shift.state === 'PENDING_ACCEPTANCE' && props.bootstrap?.capabilities.entities.shift.decideHandover && <span className="mt-1 flex gap-1"><button type="button" onClick={() => { setCommand({shift, action: 'start'}); setCommandError(null); }} className="min-h-11 rounded border border-success/30 px-2 text-3xs font-semibold text-success-strong">Допустить</button><button type="button" onClick={() => { setCommand({shift, action: 'decline'}); setCommandSummary(''); setCommandError(null); }} className="min-h-11 rounded border border-destructive/30 px-2 text-3xs font-semibold text-destructive-strong">Отказать</button></span>}{shift.state === 'STARTED' && props.bootstrap?.capabilities.entities.shift.prepareHandover && <button type="button" onClick={() => { setCommand({shift, action: 'handover'}); setCommandError(null); }} className="mt-1 min-h-11 rounded border border-signal/30 px-2 text-3xs font-semibold text-signal-strong">Передать</button>}</div>
                    <span className="mr-2 shrink-0 rounded bg-muted px-1.5 py-1 text-3xs font-semibold">{SHIFT_STATE_LABEL[shift.state]}</span>
                  </div>
                  <div className="relative h-7 rounded bg-muted">
                    <div className={cn('absolute top-0.5 h-6 overflow-hidden rounded px-3 py-1 text-3xs font-semibold text-white', shift.state === 'STARTED' ? 'bg-success-strong' : shift.state === 'CANCELLED' ? 'bg-destructive-strong' : 'bg-signal-strong')} style={{ left: `${left}%`, width: `${width}%` }}>
                      {start ? formatTimeInTimezone(start, timezone) : '—'} – {end ? formatTimeInTimezone(end, timezone) : '—'}
                    </div>
                    {/* Подпись времени только у первой строки: линия проходит
                        через все ряды, повторять ярлык на каждом незачем. */}
                    {now && (
                      <div className="absolute bottom-[-8px] top-[-8px] w-px bg-signal" style={{ left: `${now.left}%` }}>
                        {shiftIndex === 0 && (
                          <span className="absolute -top-5 -translate-x-1/2 rounded bg-signal px-1.5 py-0.5 text-3xs text-white">{now.label}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            }) : <div className="col-span-2 py-16 text-center text-sm text-muted-foreground">Смены на сегодня не созданы.</div>}
          </div>
          <div className="mt-3 space-y-2 md:hidden">{todayShifts.slice(0, 8).map((shift) => { const equipment = props.equipment.find((item) => item.id === shift.equipmentId); return <article key={shift.id} className="rounded-lg border border-border p-3"><div className="flex items-center justify-between gap-2"><b className="truncate text-sm">{equipment?.name || 'Установка'}</b><span className="rounded bg-muted px-2 py-1 text-2xs">{SHIFT_STATE_LABEL[shift.state]}</span></div><div className="mt-2 text-xs text-muted-foreground">{shift.type === 'DAY' ? 'Дневная 08:00–20:00' : 'Ночная 20:00–08:00'} · v{shift.version}</div><div className="mt-3 flex gap-2">{shift.state === 'PLANNED' && props.bootstrap?.capabilities.entities.shift.manage && <Button type="button" variant="outline" className="min-h-11 flex-1 text-xs" onClick={() => { setCommand({shift, action: 'request-acceptance'}); setCommandError(null); }}>Запросить допуск</Button>}{shift.state === 'PENDING_ACCEPTANCE' && props.bootstrap?.capabilities.entities.shift.decideHandover && <><Button type="button" variant="outline" className="min-h-11 flex-1 text-xs" onClick={() => { setCommand({shift, action: 'start'}); setCommandError(null); }}>Допустить</Button><Button type="button" variant="outline" className="min-h-11 flex-1 text-xs" onClick={() => { setCommand({shift, action: 'decline'}); setCommandSummary(''); setCommandError(null); }}>Отказать</Button></>}{shift.state === 'STARTED' && props.bootstrap?.capabilities.entities.shift.prepareHandover && <Button type="button" variant="outline" className="min-h-11 flex-1 text-xs" onClick={() => { setCommand({shift, action: 'handover'}); setCommandError(null); }}>Передать</Button>}</div></article>; })}{todayShifts.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">Смены не найдены.</div>}</div>
        </section>
        <aside className={cn(card, 'p-3')}>
          <div className="flex items-center justify-between"><h2 className="font-bold">Передача смены</h2><span className="rounded border border-border px-2 py-1 text-3xs text-muted-foreground">{waiting.length} действий</span></div>
          <div className="mt-2 space-y-2">
            {waiting.slice(0, 3).map((shift, index) => {
              const equipment = props.equipment.find((item) => item.id === shift.equipmentId);
              const crew = activeCrews.find((item) => item.equipment?.id === shift.equipmentId);
              const fleet = props.fleetCards.find((item) => item.id === shift.equipmentId);
              const handover = shift.handovers.find((item) => item.state === 'SUBMITTED');
              return (
                <div key={shift.id} className={cn('rounded-lg border p-2.5', index === 0 ? 'border-signal' : 'border-border')}>
                  <div className="flex gap-2"><EquipmentPhoto cardData={fleet} name={equipment?.name || 'Установка'} className="h-11 w-11 shrink-0" /><div className="min-w-0"><div className="truncate text-xs font-bold">{equipment?.name || 'Установка'}</div><div className="mt-1 truncate text-3xs text-muted-foreground">{crew?.site?.name || 'Объект не назначен'} · {crew?.name || 'Экипаж не назначен'}</div></div></div>
                  <div className="mt-2 line-clamp-2 text-3xs leading-relaxed text-muted-foreground">{handover?.summary || 'Передача ожидает решения диспетчера'}</div>
                  <div className="mt-2 grid grid-cols-2 gap-2"><Button type="button" disabled={!handover || !props.bootstrap?.capabilities.entities.shift.decideHandover} onClick={() => handover && void acceptHandover(handover)} className="min-h-11 w-full bg-signal-strong text-2xs hover:bg-signal-strong">Принять</Button><Button type="button" variant="outline" disabled={!handover || !props.bootstrap?.capabilities.entities.shift.decideHandover} onClick={() => { if (!handover) return; setReworkTarget(handover); setReworkReason(''); setCommandError(null); }} className="min-h-11 w-full text-2xs">На доработку</Button></div>
                </div>
              );
            })}
            {waiting.length === 0 && <div className="py-8 text-center text-xs text-muted-foreground">Передачи на приёмку отсутствуют.</div>}
          </div>
        </aside>
      </div>
      <section className={cn(card, 'mt-2 p-3')}>
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Экипажи и загрузка</h2>
          <span className="text-xs text-muted-foreground">{activeCrews.length} активных экипажей</span>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-5">
          {activeCrews.length > 0 ? activeCrews.slice(0, 5).map((crew) => {
            const state = crew.equipment ? props.readinessByEquipment[crew.equipment.id] : null;
            const load = state?.score ?? 0;
            return (
              <article key={crew.id} className="rounded-lg border border-border p-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><h3 className="truncate text-xs font-bold">{crew.name}</h3><p className="mt-1 truncate text-3xs text-muted-foreground">{crew.operator?.name || 'Оператор не назначен'} · {crew.assistants.length + (crew.operator ? 1 : 0)} чел.</p></div>
                  <span className={cn('rounded px-2 py-1 text-3xs font-semibold', state?.canOperate ? 'bg-success/10 text-success-strong' : 'bg-signal/10 text-signal-strong')}>{state?.canOperate ? 'Готов' : 'Проверка'}</span>
                </div>
                <div className="mt-2 truncate text-2xs text-muted-foreground">{crew.equipment?.name || 'Техника не назначена'}</div>
                <div className="mt-1 text-3xs text-muted-foreground">{crew.site?.name || 'Объект не назначен'}</div>
                <div className="mt-2 flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border"><div className={cn('h-full rounded-full', load >= 85 ? 'bg-success-strong' : 'bg-signal-strong')} style={{ width: `${load}%` }} /></div><b className="text-3xs">{load}%</b></div>
              </article>
            );
          }) : <div className="col-span-5 py-8 text-center text-sm text-muted-foreground">Активные экипажи не назначены.</div>}
        </div>
      </section>
      <ProcessRoleStrip
        ariaLabel="Роли передачи операторской смены"
        roles={[
          { label: 'Оператор', icon: 'operator', tasks: ['Открыть смену', 'Провести осмотр', 'Передать смену'], tone: 'green' },
          { label: 'Диспетчер', icon: 'crew', tasks: ['Проверить готовность', 'Принять передачу', 'Запустить смену'], tone: 'blue' },
          { label: 'Механик', icon: 'repair', tasks: ['Устранить дефект', 'Подтвердить выполнение', 'Вернуть технику'], tone: 'orange' },
        ]}
      />
      <CommandDialog
        open={reworkTarget !== null}
        pending={commandPending}
        title="Вернуть передачу на доработку"
        description={reworkTarget ? `Пакет v${reworkTarget.version} · ${timezone}` : undefined}
        onClose={() => { setReworkTarget(null); setReworkReason(''); setCommandError(null); }}
        footer={<Button type="button" disabled={commandPending || reworkReason.trim().length < 3} onClick={() => reworkTarget && void reworkHandover(reworkTarget, reworkReason)} className="bg-signal-strong hover:bg-signal-strong">{commandPending ? 'Выполняется…' : 'Вернуть оператору'}</Button>}
      >
        <div className="space-y-3 text-sm">
          <p>Оператор получит пакет обратно и сможет передать его заново. Прежняя передача останется в журнале без изменений.</p>
          <label className="grid gap-1 font-medium" htmlFor="handover-rework-reason">
            Что нужно исправить
            <textarea
              id="handover-rework-reason"
              value={reworkReason}
              onChange={(event) => setReworkReason(event.target.value)}
              maxLength={1000}
              className="min-h-24 rounded-md border border-input bg-background p-3 font-normal"
            />
            <span className="text-2xs font-normal text-muted-foreground">Причина попадёт в журнал передач и будет видна оператору. От 3 до 1000 символов.</span>
          </label>
          {commandError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive-strong">{commandError}</p>}
        </div>
      </CommandDialog>
      <CommandDialog
        open={command !== null}
        pending={commandPending}
        title={command?.action === 'start' ? 'Допустить смену к работе'
          : command?.action === 'request-acceptance' ? 'Запросить допуск у диспетчера'
            : command?.action === 'decline' ? 'Отказать в допуске'
              : 'Передать смену диспетчеру'}
        description={command ? `Версия ${command.shift.version} · ${command.shift.type === 'DAY' ? 'дневная' : 'ночная'} смена · ${timezone}` : undefined}
        onClose={() => { setCommand(null); setCommandSummary(''); setCommandError(null); }}
        footer={<Button type="button" disabled={commandPending || ((command?.action === 'handover' || command?.action === 'decline') && commandSummary.trim().length < 3)} onClick={() => command && void runShiftAction(command.shift, command.action)} className="bg-signal-strong hover:bg-signal-strong">{commandPending ? 'Выполняется…' : 'Подтвердить действие'}</Button>}
      >
        <div className="space-y-3 text-sm"><p>{command?.action === 'start' ? 'Будет создан новый снимок готовности. Допуск заблокируется, если опубликованные правила требуют действующий наряд.' : command?.action === 'request-acceptance' ? 'Установка заявляется готовой. Смену откроет диспетчер после проверки доказательств — до его решения работать нельзя.' : command?.action === 'decline' ? 'Смена вернётся оператору в статус «Запланирована». Причина попадёт в журнал и будет видна оператору.' : 'После передачи диспетчер получит неизменяемую запись и сможет принять смену либо вернуть её на доработку.'}</p>{(command?.action === 'handover' || command?.action === 'decline') && <label className="grid gap-1 font-medium">{command.action === 'decline' ? 'Что мешает допустить установку' : 'Состояние техники и незавершённые работы'}<textarea value={commandSummary} onChange={(event) => setCommandSummary(event.target.value)} className="min-h-24 rounded-md border border-input bg-background p-3 font-normal" /></label>}{commandError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive-strong">{commandError}</p>}</div>
      </CommandDialog>
    </>
  );
}
