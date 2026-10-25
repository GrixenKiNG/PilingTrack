import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { ClearanceDocument } from '@/modules/users';
import { RowList, ValueRow } from './ui';

/**
 * Строка состояния документа в карточке допуска.
 *
 * Дата, а не просто «действителен»: «до 15.07.2026» само говорит человеку,
 * когда идти продлевать, и снимает нужду открывать карточку документа.
 */
function documentStatusText(document: ClearanceDocument): string {
  const until = document.expiresAt
    ? new Date(document.expiresAt).toLocaleDateString('ru-RU')
    : null;
  switch (document.status) {
    case 'missing': return 'нет документа';
    case 'expired': return until ? `просрочен ${until}` : 'просрочен';
    case 'expiring': return until ? `истекает ${until}` : 'истекает';
    case 'perpetual': return 'бессрочный';
    default: return until ? `до ${until}` : 'действителен';
  }
}

/**
 * Тип смены по часам телефона.
 *
 * День длится с 07:00 до 19:00, ночь — с 19:00 до 07:00 (решение владельца
 * 26.09.2026). Раньше границы стояли на 20:00 и 08:00, и смена, начатая в
 * 19:30, записывалась дневной — а начатая в 07:30 ночной.
 */
export function shiftTypeByClock(): 'DAY' | 'NIGHT' {
  const hour = new Date().getHours();
  return hour >= 7 && hour < 19 ? 'DAY' : 'NIGHT';
}

/** Что предлагаем человеку до приёмки установки: оба типа смены со своими окнами. */
const SHIFT_TYPE_CHOICES: { value: 'DAY' | 'NIGHT'; label: string }[] = [
  { value: 'DAY', label: 'Смена: дневная (07:00–19:00)' },
  { value: 'NIGHT', label: 'Смена: ночная (19:00–07:00)' },
];

/**
 * Выбор типа смены перед приёмкой установки.
 *
 * Тип смены записывается в отчёт и определяет всю смену, а по часам телефона
 * его не угадать: смену начинают до пуска, а не по будильнику. Показываем оба
 * варианта с окнами — человек видит, что именно уйдёт на сервер, и может
 * поправить, если телефон идёт не по сменному времени.
 */
export function ShiftTypePicker({ value, onChange }: {
  value: 'DAY' | 'NIGHT';
  onChange: (type: 'DAY' | 'NIGHT') => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">Тип смены</p>
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-1">
        {SHIFT_TYPE_CHOICES.map((choice) => (
          <button
            key={choice.value}
            type="button"
            aria-pressed={value === choice.value}
            onClick={() => onChange(choice.value)}
            className={cn(
              'min-h-12 rounded-lg px-3 text-base font-medium transition-colors',
              value === choice.value
                ? 'border bg-secondary font-semibold text-foreground shadow-xs'
                : 'text-muted-foreground',
            )}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Личный допуск одной строкой, раскрывается касанием.
 *
 * Список из тринадцати удостоверений — это лист на полэкрана, который человек
 * видит каждое утро и мимо которого проходит, не читая. Ему нужен ответ на
 * один вопрос: пускают ли сегодня. Сроки нужны раз в несколько месяцев, когда
 * что-то подходит к концу, — тогда их и открывают.
 */
export function ClearanceRow({ cleared, operatorName, documents }: {
  cleared: boolean;
  operatorName: string;
  documents: ClearanceDocument[];
}) {
  const [open, setOpen] = useState(false);
  const attention = documents.filter(
    (document) => document.status === 'expired'
      || document.status === 'missing'
      || document.status === 'expiring',
  );
  const nearest = documents
    .map((document) => document.expiresAt)
    .filter((value): value is string => Boolean(value))
    .sort()[0];

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex min-h-12 w-full items-center gap-3 px-3 py-2.5 text-left active:bg-muted/60"
      >
        <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white',
          cleared ? 'bg-success' : 'bg-warning')}>
          {cleared ? '✓' : '!'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-medium text-foreground">
            {cleared ? 'Допуск подтверждён' : 'К работе не допущен'}
          </span>
          <span className="block truncate text-sm text-muted-foreground">
            {operatorName} · документов: {documents.length}
            {attention.length > 0
              ? ' · требуют внимания: ' + attention.length
              : nearest ? ' · ближайший срок ' + new Date(nearest).toLocaleDateString('ru-RU') : ''}
          </span>
        </span>
        <span className="shrink-0 text-muted-foreground">{open ? '⌄' : '›'}</span>
      </button>

      {open && (
        documents.length > 0 ? (
          <RowList>
            {documents.map((document) => (
              <li key={document.typeId}>
                <ValueRow
                  label={document.typeName}
                  value={documentStatusText(document)}
                  tone={document.status === 'expired' || document.status === 'missing'
                    || document.status === 'expiring' ? 'warn' : 'ok'}
                />
              </li>
            ))}
          </RowList>
        ) : (
          <p className="border-t border-border px-3 py-2 text-sm text-muted-foreground">
            Обязательные документы администратором не заданы — проверять нечего
          </p>
        )
      )}
    </div>
  );
}

export function Blockers({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2">
      {items.map((item) => <li key={item} className="text-base text-destructive-strong">{item}</li>)}
    </ul>
  );
}

/*
  Время работы. Пока смена идёт — бежит от пуска. Когда сервер записал сдачу
  (`endedAt`), счёт останавливается на этой отметке: закрытая смена не должна
  «работать» дальше, пока экран открыт.
*/
export function useElapsed(startedAt: string | null, endedAt: string | null = null): string | null {
  const fixedEnd = endedAt ? new Date(endedAt).getTime() : Number.NaN;
  const frozen = !Number.isNaN(fixedEnd);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!startedAt || frozen) return;
    const first = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [startedAt, frozen]);
  const reference = frozen ? fixedEnd : now;
  if (!startedAt || reference === null) return null;
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return null;
  const seconds = Math.max(0, Math.floor((reference - started) / 1000));
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}
