import { HANDOVER_ICON, HANDOVER_PILL } from './readiness-centre-metrics';






import { formatDateTimeInTimezone } from '@/lib/timezone';
import { cn } from '@/lib/utils';

import { handoverRoleLabel, type HandoverJournalEvent } from '../handover-journal';






/** Одно событие ленты передачи. Вынесено, чтобы список и раскрытие «полного
 *  журнала» рисовали строку одинаково, а не двумя копиями разметки. */
export function HandoverEvent({ event, latest, timezone }: {
  event: HandoverJournalEvent;
  latest: boolean;
  timezone: string | undefined;
}) {
  const EventIcon = HANDOVER_ICON[event.kind];
  const pill = HANDOVER_PILL[event.kind];
  return (
    <li className="relative">
      {/* Кружок с иконкой вместо безымянной точки: тип события читается,
          не доходя до подписи. */}
      <span className={cn('absolute -left-[35px] top-0 grid h-[18px] w-[18px] place-items-center rounded-full border bg-card',
        latest ? 'border-signal text-signal-strong' : event.kind === 'REWORKED' ? 'border-warning text-warning-strong' : 'border-border text-muted-foreground')}>
        <EventIcon className="h-2.5 w-2.5" />
      </span>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-xs font-semibold">{event.label}</div>
        <div className="flex shrink-0 items-center gap-1">
          {/* Самоприёмку показываем видимой меткой: разрешена, но «кто
              проверил» — вопрос для разбора, и в аудите он лежал незаметно. */}
          {event.selfAccepted && (
            <span className="rounded border border-warning bg-warning/10 px-1.5 py-0.5 text-3xs font-semibold text-warning-strong">
              Самоприёмка
            </span>
          )}
          <span className={cn('rounded border px-1.5 py-0.5 text-3xs font-semibold', pill.cls)}>
            {pill.label}
          </span>
        </div>
      </div>
      <div className="mt-1 text-2xs leading-relaxed text-muted-foreground">
        {formatDateTimeInTimezone(event.occurredAt, timezone)}
        {event.actorName ? ` · ${event.actorName}` : ''}
        {handoverRoleLabel(event.actorRole) ? ` (${handoverRoleLabel(event.actorRole)})` : ''}
        {event.selfAccepted ? ' · принято тем же, кто сдал' : ''}
        {` · пакет v${event.packageVersion}`}
      </div>
      {event.comment && (
        <p className="mt-1 rounded border border-border bg-muted/40 p-2 text-2xs leading-relaxed">{event.comment}</p>
      )}
    </li>
  );
}
