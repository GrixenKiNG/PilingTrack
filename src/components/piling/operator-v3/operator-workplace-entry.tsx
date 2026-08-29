'use client';

import {useCallback, useState} from 'react';
import {Button} from '@/components/ui/button';
import {normalizeOperatorWorkplace} from './api/normalize-workplace';
import {getOperatorDeviceId} from './offline/device-identity';
import {OperatorOfflineAdapter} from './offline/operator-offline-adapter';
import type {SynchronizationReport} from './offline/queue-synchronizer';
import {OperatorWorkplaceScreen} from './operator-workplace-screen';
import {useOperatorWorkplace} from './state/use-operator-workplace';
import {SyncQueuePanel} from './sync-queue-panel';

export function OperatorWorkplaceEntry() {
  const {state, refresh, acceptSnapshot} = useOperatorWorkplace();
  const [deviceId] = useState(getOperatorDeviceId);
  const acceptSynchronizedSnapshot = useCallback((report: SynchronizationReport) => {
    const latest = [...report.confirmedCommands].reverse().find((item) => item.workplace !== undefined)?.workplace;
    if (latest === undefined) return;
    try { acceptSnapshot(normalizeOperatorWorkplace(latest)); }
    catch { void refresh(); }
  }, [acceptSnapshot, refresh]);
  if (state.status === 'ЗАГРУЗКА') {
    return <main className="mx-auto min-h-[60dvh] max-w-7xl px-4 py-6" aria-busy="true"><p className="text-sm text-muted-foreground">Загружаем рабочее место</p></main>;
  }
  if (state.status === 'ОШИБКА') {
    return <main className="mx-auto min-h-[60dvh] max-w-7xl px-4 py-6"><section role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-5"><h1 className="text-lg font-semibold">Рабочее место временно недоступно</h1><p className="mt-2 text-sm text-muted-foreground">{state.message}</p><Button className="mt-4" onClick={refresh}>Повторить</Button></section></main>;
  }
  return <OperatorOfflineAdapter key={`${state.snapshot.operator.id}:${deviceId}`} operatorId={state.snapshot.operator.id} deviceId={deviceId} acceptSnapshot={acceptSnapshot}>
    {({execute, busyActionId, message, queue, synchronizer}) => <>
      <OperatorWorkplaceScreen snapshot={state.snapshot} busyActionId={busyActionId} message={message} onAction={(action, payload, commandId, aggregateId) => execute(action, payload, commandId, aggregateId)} />
      <div className="mx-auto -mt-24 max-w-7xl px-4 pb-28 md:-mt-4 md:pb-8">
        <SyncQueuePanel queue={queue} synchronizer={synchronizer} onSynchronized={acceptSynchronizedSnapshot} />
      </div>
    </>}
  </OperatorOfflineAdapter>;
}
