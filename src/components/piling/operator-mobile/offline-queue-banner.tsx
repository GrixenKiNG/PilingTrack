'use client';

import {useState} from 'react';
import {AUTH_WAIT_MESSAGE, describeCommand, type QueuedCommand} from './offline-queue';

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
  if (items.length === 0) return null;
  const failed = items.filter((item) => item.state === 'FAILED');
  const pending = items.filter((item) => item.state === 'PENDING');
  const waitsForLogin = pending.some((item) => item.lastError === AUTH_WAIT_MESSAGE);

  return (
    <div className={className} data-testid="offline-queue-banner">
      {pending.length > 0 && (
        <div role="status" className="rounded-xl border border-warning bg-warning/10 px-3 py-2 text-2xs font-medium text-warning-strong">
          На устройстве: {pending.map((item) => item.label).join(', ')}.{' '}
          {waitsForLogin ? AUTH_WAIT_MESSAGE : 'Отправим, когда появится связь.'}
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
        {item.label} не принята: {item.lastError ?? 'причина неизвестна'}
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
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onRetry(item.clientCommandId)}
            className="rounded border border-destructive px-2 py-1 font-semibold">
            Повторить
          </button>
          <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}
            className="rounded border border-destructive px-2 py-1 font-semibold">
            {open ? 'Скрыть' : 'Что введено'}
          </button>
          <button type="button" onClick={() => { setOpen(true); setConfirming(true); }}
            className="rounded border border-destructive px-2 py-1 font-semibold">
            Убрать
          </button>
        </div>
      )}
    </div>
  );
}
