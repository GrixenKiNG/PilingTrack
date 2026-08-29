import {cn} from '@/lib/utils';
import type {OperatorWorkplace} from '../api/contracts';

const time = (value: string) =>
  new Intl.DateTimeFormat('ru-RU', {hour: '2-digit', minute: '2-digit'}).format(new Date(value));

const severityLabels: Record<string, string> = {
  NORMAL: 'Наблюдение',
  HIGH: 'Требует ремонта',
  CRITICAL: 'Критичный',
};

/**
 * Что открыто по этой машине прямо сейчас: дефекты и опасные события смены.
 *
 * Список только показывает. Фиксируют дефект быстрыми действиями безопасности —
 * они доступны на любом экране, и дублировать их здесь значило бы завести второй
 * путь к той же команде.
 */
export function DefectsTab({snapshot}: {snapshot: OperatorWorkplace}) {
  const {defects, incidents} = snapshot;

  if (defects.length === 0 && incidents.length === 0) {
    return (
      <section aria-label="Дефекты и опасные события" className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Открытых записей нет</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          По этой машине в текущей смене не зафиксировано ни дефектов, ни опасных событий.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Дефекты и опасные события" className="space-y-3">
      {incidents.map((incident) => (
        <article
          key={incident.id}
          className={cn(
            'rounded-xl border p-4',
            incident.stopRequired ? 'border-destructive/50 bg-destructive/5' : 'bg-card',
          )}
        >
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-semibold">{incident.title}</h3>
            <time className="shrink-0 text-xs tabular-nums text-muted-foreground" dateTime={incident.occurredAt}>
              {time(incident.occurredAt)}
            </time>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{incident.description}</p>
          <p className="mt-2 text-sm font-medium">
            {incident.stopRequired ? 'Работа остановлена' : 'Опасное событие · без остановки'}
          </p>
        </article>
      ))}

      {defects.map((defect) => (
        <article key={defect.id} className="rounded-xl border bg-card p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-semibold">{defect.title}</h3>
            <time className="shrink-0 text-xs tabular-nums text-muted-foreground" dateTime={defect.reportedAt}>
              {time(defect.reportedAt)}
            </time>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{defect.description}</p>
          <p className="mt-2 text-sm font-medium">
            {severityLabels[defect.severity] ?? defect.severity}
            {defect.evidenceMediaIds.length > 0 && ` · фото: ${defect.evidenceMediaIds.length}`}
          </p>
        </article>
      ))}
    </section>
  );
}
