'use client';

import {useEffect, useState} from 'react';
import {usePilingStore} from '@/lib/store';
import {
  AUTH_WAIT_MESSAGE, describeCommand, foreignQueueSummary, subscribeQueue, type QueuedCommand,
} from './offline-queue';

/** Чужие записи на устройстве; перечитываются при смене очереди и вошедшего. */
function useForeignQueue() {
  const ownerId = usePilingStore((state) => state.currentUser?.id ?? null);
  const [summary, setSummary] = useState(() => ({count: 0, owners: [] as string[]}));
  useEffect(() => {
    const sync = () => setSummary(foreignQueueSummary());
    sync();
    return subscribeQueue(sync);
  }, [ownerId]);
  return summary;
}

/**
 * Что записано на устройстве и ещё не ушло на сервер — одна плашка для всех
 * экранов машиниста.
 *
 * Без неё автономная работа неотличима от потери данных: машинист ввёл сваи,
 * экран промолчал, а в отчёте их нет. Ждущие связи записи показываем сводкой,
 * отвергнутые — каждую отдельно, с составом записи (чтобы внести её заново)
 * и тремя выходами: повторить, показать, что введено, убрать с устройства.
 */
export function OfflineQueueBanner({items, onRetry, onDiscard, className = 'space-y-1 px-3 pt-2'}: {
  items: QueuedCommand[];
  onRetry: (clientCommandId: string) => void;
  onDiscard: (clientCommandId: string) => void;
  className?: string;
}) {
  const foreign = useForeignQueue();
  if (items.length === 0 && foreign.count === 0) return null;
  const failed = items.filter((item) => item.state === 'FAILED');
  const pending = items.filter((item) => item.state === 'PENDING');
  const waitsForLogin = pending.some((item) => item.lastError === AUTH_WAIT_MESSAGE);
  /*
    Отказ сервера от обрыва связи отличаем по языку строки: сетевой сбой
    браузера и таймаут приходят англоязычным текстом («Failed to fetch»,
    «Load failed», «signal timed out»), а отказ сервера — русским (`markAttempt`
    кладёт `error.message`, а он у `ApiError` прочитан из тела ответа).
    Без этого 500/503/429 выглядели как «ждём связи», хотя связь есть
    (аудит R76, находка 6). `AUTH_WAIT_MESSAGE` разбирается отдельной ветвью.
  */
  /*
    Один и тот же отказ приходит от каждой ждущей записи: пять записей с 503
    давали пять одинаковых фраз подряд. Сворачиваем повторы, сохраняя порядок
    первого появления, и дописываем «(×N)» — сколько записей ждут по этой
    причине.
  */
  const serverReasons = Array.from(
    pending
      .map((item) => item.lastError)
      .filter((text): text is string =>
        !!text && text !== AUTH_WAIT_MESSAGE && /[А-Яа-яЁё]/.test(text))
      .reduce((counts, text) => counts.set(text, (counts.get(text) ?? 0) + 1), new Map<string, number>()),
    ([text, count]) => (count > 1 ? `${text} (×${count})` : text),
  );

  return (
    <div className={className} data-testid="offline-queue-banner">
      {foreign.count > 0 && (
        /*
          Записи прежнего владельца телефона от имени вошедшего не уходят —
          выработка досталась бы не тому. Но без этой строки они терялись
          молча, если хозяин больше не входил на этом телефоне (аудит R43 №2).
        */
        <div role="status" className="rounded-xl border border-warning bg-warning/10 px-3 py-2 text-2xs font-medium text-warning-strong">
          На телефоне лежат неотправленные записи другого сотрудника
          {foreign.owners.length > 0 ? ` (${foreign.owners.join(', ')})` : ''}: {foreign.count}.
          {' '}Они уйдут, когда владелец войдёт на этом телефоне. Сообщите ему или мастеру.
        </div>
      )}
      {pending.length > 0 && (
        <div role="status" className="rounded-xl border border-warning bg-warning/10 px-3 py-2 text-2xs font-medium text-warning-strong">
          На устройстве: {pending.map((item) => item.label).join(', ')}.{' '}
          {waitsForLogin
            ? AUTH_WAIT_MESSAGE
            : serverReasons.length > 0
              ? 'Сервер не принял запись, повторим автоматически.'
              : 'Отправим, когда появится связь.'}
          {serverReasons.length > 0 && (
            <span className="mt-1 block font-normal">{serverReasons.join(' · ')}</span>
          )}
        </div>
      )}
      {failed.map((item) => (
        <FailedItem key={item.clientCommandId} item={item} onRetry={onRetry} onDiscard={onDiscard} />
      ))}
    </div>
  );
}

function FailedItem({item, onRetry, onDiscard}: {
  item: QueuedCommand;
  onRetry: (clientCommandId: string) => void;
  onDiscard: (clientCommandId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const queuedAt = new Date(item.queuedAt);
  const when = Number.isNaN(queuedAt.getTime())
    ? ''
    : queuedAt.toLocaleString('ru-RU', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'});

  return (
    <div role="alert" className="space-y-2 rounded-xl border border-destructive bg-destructive/10 px-3 py-2 text-2xs font-medium text-destructive-strong">
      <p className="min-w-0 break-words">
        {item.label} не принята
      </p>
      {/* Причина отказа сервера — главное на карточке: по ней решают, поможет ли повтор. */}
      <p className="min-w-0 break-words text-sm font-semibold">
        {item.lastError ?? 'причина неизвестна'}
      </p>
      {open && (
        <p className="break-words font-normal text-foreground">
          Введено{when ? ` ${when}` : ''}: {describeCommand(item.command)}
          {item.attempts > 1 ? ` · попыток: ${item.attempts}` : ''}
        </p>
      )}
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-normal text-foreground">Убрать запись с устройства? Внести её заново можно только вручную.</span>
          <button type="button" onClick={() => onDiscard(item.clientCommandId)}
            className="rounded border border-destructive bg-destructive px-2 py-1 font-semibold text-white">
            Да, убрать
          </button>
          <button type="button" onClick={() => setConfirming(false)}
            className="rounded border border-destructive px-2 py-1 font-semibold">
            Оставить
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { setOpen(true); setConfirming(true); }}
              className="rounded border border-destructive bg-destructive px-2 py-1 font-semibold text-white">
              Удалить запись
            </button>
            <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}
              className="rounded border border-destructive px-2 py-1 font-semibold">
              {open ? 'Скрыть' : 'Что введено'}
            </button>
          </div>
          <div className="space-y-1">
            <button type="button" onClick={() => onRetry(item.clientCommandId)}
              className="rounded border border-destructive px-2 py-1 font-normal">
              Повторить
            </button>
            <p className="break-words font-normal text-foreground">
              Повтор отправит то же самое — поможет, только если причина уже устранена (смену переоткрыли, справочник поправили)
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
