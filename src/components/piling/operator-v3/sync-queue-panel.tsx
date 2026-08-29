'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {Button} from '@/components/ui/button';
import type {OperatorCommandQueue, QueueSummary} from './offline/command-queue';
import type {OperatorQueueSynchronizer, SynchronizationReport} from './offline/queue-synchronizer';
import {useConnectivity} from './use-connectivity';

const EMPTY_SUMMARY: QueueSummary = {pending: 0, sending: 0, failed: 0, conflicts: 0, total: 0};
const TEMPORARY_FAILURE_RETRY_MS = 6_000;

export function SyncQueuePanel({queue, synchronizer, onSynchronized}: {queue: OperatorCommandQueue; synchronizer: OperatorQueueSynchronizer; onSynchronized?: (report: SynchronizationReport) => void}) {
  const connectivity = useConnectivity();
  const [summary, setSummary] = useState<QueueSummary>(EMPTY_SUMMARY);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('Очередь готова');
  const lastAutomaticAttempt = useRef('');

  const refresh = useCallback(async () => { setSummary(await queue.summary()); }, [queue]);
  const synchronize = useCallback(async () => {
    if (!connectivity.online || syncing) return;
    setSyncing(true);
    setMessage('Синхронизация выполняется');
    try {
      const result = await synchronizer.synchronize();
      onSynchronized?.(result);
      setMessage(result.conflicts > 0 ? 'Есть команды, требующие проверки' : result.remaining > 0 ? 'Часть команд ожидает повторной отправки' : 'Все команды переданы');
    } catch {
      setMessage('Не удалось выполнить синхронизацию');
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

  return <section aria-label="Синхронизация действий" className="rounded-xl border bg-card p-4 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="font-semibold">Синхронизация действий</h2>
        <p className="mt-1 text-sm text-muted-foreground">{connectivity.label}</p>
      </div>
      <Button type="button" variant="outline" disabled={!connectivity.online || syncing || summary.total === 0} onClick={() => { void synchronize(); }}>
        {syncing ? 'Передаём...' : 'Передать сейчас'}
      </Button>
    </div>
    <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
      <p><span className="block text-muted-foreground">Ожидают</span><strong>{summary.pending + summary.failed}</strong></p>
      <p><span className="block text-muted-foreground">Передаются</span><strong>{summary.sending}</strong></p>
      <p><span className="block text-muted-foreground">Требуют проверки</span><strong>{summary.conflicts}</strong></p>
      <p><span className="block text-muted-foreground">Всего на устройстве</span><strong>{summary.total}</strong></p>
    </div>
    <p aria-live="polite" className="mt-3 text-sm">{message}</p>
  </section>;
}
