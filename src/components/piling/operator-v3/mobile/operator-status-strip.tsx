'use client';

import {useId, useState} from 'react';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import type {OperatorCommandQueue} from '../offline/command-queue';
import type {OperatorQueueSynchronizer, SynchronizationReport} from '../offline/queue-synchronizer';
import {useQueueSync} from './use-queue-sync';

function clock(): string {
  return new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'});
}

/**
 * Полоса связи — сквозное состояние из фазы H спецификации: она появляется
 * поверх любого экрана, а не вместо него.
 *
 * Раньше это была панель под навигацией в самом низу страницы: чтобы узнать,
 * ушли ли записи, оператор пролистывал экран до конца. Наверху ответ виден, не
 * трогая экран, — а это как раз то, что человек в кабине проверяет чаще всего.
 */
export function OperatorStatusStrip({queue, synchronizer, onSynchronized}: {
  queue: OperatorCommandQueue;
  synchronizer: OperatorQueueSynchronizer;
  onSynchronized?: (report: SynchronizationReport) => void;
}) {
  const sync = useQueueSync(queue, synchronizer, onSynchronized);
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();

  const waiting = sync.summary.pending + sync.summary.failed;
  const offline = !sync.online;
  // Очередь называется вслух только когда в ней что-то есть: «в очереди 0» —
  // это шум, который оператор учится не читать.
  const state = offline
    ? (waiting > 0 ? `Автономно · в очереди ${waiting}` : 'Автономно')
    : (waiting > 0 ? `Отправляем · в очереди ${waiting}` : 'На связи');

  return (
    <div className={cn(
      'sticky top-0 z-30 border-b',
      offline ? 'bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100' : 'bg-card',
    )}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={detailId}
        className="flex min-h-11 w-full items-center justify-between gap-3 px-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden className={cn('size-2 shrink-0 rounded-full', offline ? 'bg-amber-500' : 'bg-emerald-500')} />
          <span className="truncate text-sm font-medium">{state}</span>
        </span>
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{clock()}</span>
      </button>

      {expanded && (
        <div id={detailId} className="border-t px-4 py-3">
          {sync.summary.total === 0 ? (
            <p className="text-sm text-muted-foreground">
              Всё записанное передано на сервер. Ничего не ждёт отправки.
            </p>
          ) : (
            <>
              <dl className="grid gap-1.5 text-sm">
                {waiting > 0 && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Ждут отправки</dt>
                    <dd className="font-medium tabular-nums">{waiting}</dd>
                  </div>
                )}
                {sync.summary.sending > 0 && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Передаются сейчас</dt>
                    <dd className="font-medium tabular-nums">{sync.summary.sending}</dd>
                  </div>
                )}
                {sync.summary.conflicts > 0 && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-destructive">Требуют разбора</dt>
                    <dd className="font-medium tabular-nums text-destructive">{sync.summary.conflicts}</dd>
                  </div>
                )}
              </dl>
              <p className="mt-3 text-sm text-muted-foreground">
                Работать можно. Всё записанное уйдёт на сервер, как только появится связь — ничего не потеряется.
              </p>
            </>
          )}
          <div className="mt-3 flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={!sync.online || sync.syncing || sync.summary.total === 0}
              onClick={sync.synchronize}
            >
              {sync.syncing ? 'Отправляем…' : 'Попробовать отправить'}
            </Button>
            <p aria-live="polite" className="text-sm text-muted-foreground">{sync.message}</p>
          </div>
        </div>
      )}
    </div>
  );
}
