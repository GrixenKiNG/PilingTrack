import { HandoverEvent } from './readiness-centre-handover';
import { HANDOVER_PREVIEW } from './readiness-centre-metrics';
import { AlertCircle, CheckCircle2, ChevronRight, Send } from '@/components/piling/icons/unified-icons';
import { card } from '../settings/shared-ui';
import { Button } from '@/components/ui/button';
import { formatDateTimeInTimezone } from '@/lib/timezone';
import { cn } from '@/lib/utils';
import { buildHandoverJournal } from '../handover-journal';
import { buildAuthoritativeReadinessPresentation, buildUnavailableReadinessPresentation } from '../authoritative-presentation';
import { EquipmentPhoto } from './shared';
import type { ReferenceUiProps } from './types';

interface ReadinessHandoverPanelProps {
  handoverJournal: ReturnType<typeof buildHandoverJournal>;
  props: ReferenceUiProps;
  awaitingAcceptance: ReferenceUiProps['equipment'];
  selected: ReferenceUiProps['equipment'][number];
}

export function ReadinessHandoverPanel({ handoverJournal, props, awaitingAcceptance, selected }: ReadinessHandoverPanelProps) {
  return (
<aside className="flex flex-col gap-3 md:col-span-2 xl:col-span-1">
        <section className={cn(card, 'p-4')}>
          <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 font-bold"><Send className="h-4 w-4 text-muted-foreground" />Передача и приёмка</h2><span className="text-2xs text-muted-foreground">неизменяемый журнал</span></div>
          {handoverJournal.length === 0 ? (
            <p className="mt-3 rounded-lg border border-border p-3 text-2xs max-sm:text-sm! leading-relaxed text-muted-foreground">
              По этой установке ещё не было передач смены. Записи появятся, когда оператор передаст смену диспетчеру.
            </p>
          ) : (
            <ol className="mt-4 space-y-5 border-l border-border pl-6">
              {handoverJournal.slice(0, HANDOVER_PREVIEW).map((event, index) => (
                <HandoverEvent
                  key={event.id}
                  event={event}
                  latest={index === 0}
                  timezone={props.bootstrap?.tenant.timezone}
                />
              ))}
            </ol>
          )}
          {/*
            Полный журнал раскрывается на месте — так же, как первоисточники
            решения в «Доказательствах». Раньше кнопка уводила на вкладку
            «Отчёты», где журнала передач по этой установке нет вовсе.
          */}
          {handoverJournal.length > HANDOVER_PREVIEW && (
            <details className="mt-4 rounded-lg border border-border">
              <summary className="hit-target cursor-pointer px-3 py-2 text-xs font-semibold text-signal-strong">
                Открыть полный журнал — ещё {handoverJournal.length - HANDOVER_PREVIEW}
              </summary>
              <ol className="ml-6 space-y-5 border-l border-border py-3 pl-6 pr-3">
                {handoverJournal.slice(HANDOVER_PREVIEW).map((event) => (
                  <HandoverEvent
                    key={event.id}
                    event={event}
                    latest={false}
                    timezone={props.bootstrap?.tenant.timezone}
                  />
                ))}
              </ol>
            </details>
          )}
        </section>
        <section className={cn(card, 'flex flex-1 flex-col p-4')}>
          {/*
            Входящие — это установки, чью смену действительно ждут принять,
            а не первые три из парка. Панель показывала срез списка техники и
            подписывала его числом всех машин: диспетчер видел «входящих 12»
            при пустой очереди и три карточки, которые к передаче отношения не
            имели. Очередь определяется состоянием смены HANDOVER_PENDING —
            тем же, по которому её строит экран смен.
          */}
          <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 font-bold"><AlertCircle className="h-4 w-4 text-muted-foreground" />Входящие (диспетчер)</h2><span className="text-xs text-muted-foreground">{awaitingAcceptance.length}</span></div>
          <div className="mt-3 space-y-3">
            {awaitingAcceptance.length === 0 && (
              <p className="text-xs text-muted-foreground max-sm:text-sm">Ничего не ждёт приёмки.</p>
            )}
            {awaitingAcceptance.slice(0, 3).map((item) => {
              const itemSnapshot = props.currentReadiness.find((entry) => entry.equipmentId === item.id) ?? null;
              const itemPresentation = props.authoritativeReadinessError
                ? buildUnavailableReadinessPresentation(itemSnapshot)
                : buildAuthoritativeReadinessPresentation(itemSnapshot);
              const itemFleet = props.fleetCards.find((cardItem) => cardItem.id === item.id);
              const active = item.id === selected.id;
              // Время последней передачи по этой установке — «когда упало во входящие».
              const lastSubmitted = buildHandoverJournal(props.shifts, item.id, props.bootstrap?.selectors.actors)
                .find((event) => event.kind === 'SUBMITTED');
              const statusPill = itemPresentation.outcome === 'READY'
                ? { label: 'Готова к приёмке', cls: 'border-success/30 bg-success/10 text-success-strong' }
                : itemPresentation.outcome === 'READY_WITH_WARNING'
                  ? { label: 'Готова с замечанием', cls: 'border-warning/30 bg-warning/10 text-warning-strong' }
                  : itemPresentation.outcome === 'BLOCKED'
                    ? { label: 'Заблокирована', cls: 'border-destructive/30 bg-destructive/10 text-destructive-strong' }
                    : itemPresentation.outcome === 'ATTENTION'
                      ? { label: 'Требует решения', cls: 'border-info/30 bg-info/10 text-info-strong' }
                      : { label: 'Требует внимания', cls: 'border-warning/30 bg-warning/10 text-warning-strong' };
              return (
                <div key={item.id} className={cn('rounded-lg border p-3', active ? 'border-signal bg-signal/5' : 'border-border')}>
                  <button
                    type="button"
                    onClick={() => props.onSelect(item.id)}
                    className="flex w-full gap-3 text-left"
                    aria-label={`${item.name}: открыть карточку готовности`}
                  >
                    <EquipmentPhoto cardData={itemFleet} name={item.name} className="h-12 w-12 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="truncate text-xs font-bold">{item.name}</div>
                        {lastSubmitted && (
                          <span className="shrink-0 text-3xs text-muted-foreground">
                            {formatDateTimeInTimezone(lastSubmitted.occurredAt, props.bootstrap?.tenant.timezone)}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-2xs text-muted-foreground">{props.details[item.id]?.crew?.site?.name || 'Объект не назначен'}</div>
                      <span className={cn('mt-2 inline-block rounded border px-2 py-0.5 text-2xs font-semibold', statusPill.cls)}>
                        {statusPill.label}
                      </span>
                    </div>
                  </button>
                  {/*
                    Приёмка и возврат на доработку живут на вкладке «Смены» —
                    здесь кнопки ведут туда с уже выбранной установкой, а не
                    имитируют действие на месте.
                  */}
                  {active && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        className="h-9 flex-1 bg-signal text-white hover:bg-signal-strong"
                        onClick={() => props.onViewChange('shifts')}
                      >
                        <CheckCircle2 className="h-4 w-4" />Принять и назначить
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 flex-1"
                        onClick={() => props.onViewChange('shifts')}
                      >
                        <AlertCircle className="h-4 w-4" />Запросить доработки
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button type="button" onClick={() => props.onViewChange('shifts')} className="hit-target mt-auto flex items-center gap-1 pt-3 text-left text-xs font-semibold text-signal-strong">
            Открыть все входящие<ChevronRight className="h-4 w-4" />
          </button>
        </section>
        </aside>
  );
}
