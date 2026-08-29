'use client';

import {useEffect, useRef, useState, type ReactNode} from 'react';
import type {OperatorWorkplace} from '../api/contracts';
import type {OperatorCommandQueue} from './command-queue';
import {createOperatorOfflineServices} from './operator-offline-services';
import type {OperatorQueueSynchronizer} from './queue-synchronizer';
import {useQueuedOperatorCommand, type QueuedOperatorCommandState} from './use-queued-operator-command';

export interface OperatorOfflineAdapterValue extends QueuedOperatorCommandState {
  queue: OperatorCommandQueue;
  synchronizer: OperatorQueueSynchronizer;
}

export function OperatorOfflineAdapter({
  operatorId,
  deviceId,
  acceptSnapshot,
  children,
}: {
  operatorId: string;
  deviceId: string;
  acceptSnapshot: (snapshot: OperatorWorkplace) => void;
  children: (value: OperatorOfflineAdapterValue) => ReactNode;
}) {
  const [services] = useState(() => createOperatorOfflineServices(`оператор:${operatorId}:устройство:${deviceId}`));
  const activeMounts = useRef(0);
  useEffect(() => {
    activeMounts.current += 1;
    return () => {
      activeMounts.current -= 1;
      queueMicrotask(() => {
        if (activeMounts.current === 0) services.close();
      });
    };
  }, [services]);
  const command = useQueuedOperatorCommand(acceptSnapshot, services, deviceId);
  return children({...command, queue: services.queue, synchronizer: services.synchronizer});
}
