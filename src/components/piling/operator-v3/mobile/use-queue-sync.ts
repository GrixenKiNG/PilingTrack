'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import type {OperatorCommandQueue, QueueSummary} from '../offline/command-queue';
import type {OperatorQueueSynchronizer, SynchronizationReport} from '../offline/queue-synchronizer';
import {useConnectivity} from '../use-connectivity';

const EMPTY_SUMMARY: QueueSummary = {pending: 0, sending: 0, failed: 0, conflicts: 0, total: 0};
const TEMPORARY_FAILURE_RETRY_MS = 6_000;

export interface QueueSync {
  online: boolean;
  summary: QueueSummary;
  syncing: boolean;
  message: string;
  synchronize: () => void;
}

/**
 * Отправка очереди и её состояние. Вынесено из панели, потому что теперь этим
 * пользуются два места: свёрнутая полоса состояния наверху экрана и её
 * раскрытый список. Два экземпляра логики означали бы два независимых таймера
 * повтора на одну очередь.
 */
export function useQueueSync(
  queue: OperatorCommandQueue,
  synchronizer: OperatorQueueSynchronizer,
  onSynchronized?: (report: SynchronizationReport) => void,
): QueueSync {
  const connectivity = useConnectivity();
  const [summary, setSummary] = useState<QueueSummary>(EMPTY_SUMMARY);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('Очередь готова');
  const lastAutomaticAttempt = useRef('');

  const refresh = useCallback(async () => { setSummary(await queue.summary()); }, [queue]);

  const synchronize = useCallback(async () => {
    if (!connectivity.online || syncing) return;
    setSyncing(true);
    setMessage('Отправляем');
    try {
      const result = await synchronizer.synchronize();
      onSynchronized?.(result);
      setMessage(
        result.conflicts > 0 ? 'Есть записи, требующие разбора'
          : result.remaining > 0 ? 'Часть записей ждёт повторной отправки'
          : 'Всё передано',
      );
    } catch {
      setMessage('Не удалось отправить');
    } finally {
      setSyncing(false);
      await refresh();
    }
  }, [connectivity.online, onSynchronized, refresh, syncing, synchronizer]);

  useEffect(() => {
    let active = true;
    void queue.summary().then((value) => { if (active) setSummary(value); });
    const unsubscribe = queue.subscribe(() => { void refresh(); });
    return () => { active = false; unsubscribe(); };
  }, [queue, refresh]);

  useEffect(() => {
    if (!connectivity.online || summary.total === 0 || syncing) return;
    const attemptKey = `${summary.pending}:${summary.failed}:${summary.conflicts}:${summary.sending}`;
    if (attemptKey === lastAutomaticAttempt.current) return;
    lastAutomaticAttempt.current = attemptKey;
    void synchronize();
  }, [connectivity.online, summary, syncing, synchronize]);

  useEffect(() => {
    if (!connectivity.online || syncing || (summary.failed === 0 && summary.sending === 0)) return;
    const timer = window.setInterval(() => {
      lastAutomaticAttempt.current = '';
      void synchronize();
    }, TEMPORARY_FAILURE_RETRY_MS);
    return () => window.clearInterval(timer);
  }, [connectivity.online, summary.failed, summary.sending, syncing, synchronize]);

  return {
    online: connectivity.online,
    summary,
    syncing,
    message,
    synchronize: () => { void synchronize(); },
  };
}
