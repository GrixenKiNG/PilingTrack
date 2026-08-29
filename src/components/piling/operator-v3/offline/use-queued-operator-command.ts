'use client';

import {useCallback, useRef, useState} from 'react';
import type {OperatorAction, OperatorWorkplace} from '../api/contracts';
import {safeOperatorError} from '../api/api-error';
import {createOperatorCommandId} from '../api/action-registry';
import {normalizeOperatorWorkplace} from '../api/normalize-workplace';
import {createOfflineCommandEnvelope} from './command-envelope';
import type {OperatorOfflineServices} from './operator-offline-services';

export interface QueuedOperatorCommandState {
  execute(action: OperatorAction, payload?: Record<string, unknown>, preparedCommandId?: string, aggregateId?: string): Promise<boolean>;
  busyActionId: string | null;
  message: string | null;
}

function payloadAttachmentIds(payload: Record<string, unknown>): string[] {
  const value = payload.attachmentIds;
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))]
    : [];
}

export function useQueuedOperatorCommand(
  acceptSnapshot: (snapshot: OperatorWorkplace) => void,
  services: OperatorOfflineServices,
  deviceId: string,
): QueuedOperatorCommandState {
  const sequence = useRef(0);
  const active = useRef<string | null>(null);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const execute = useCallback(async (action: OperatorAction, payload: Record<string, unknown> = {}, preparedCommandId?: string, aggregateId?: string) => {
    if (active.current) return false;
    if (action.kind !== 'COMMAND' || !action.route || action.method !== 'POST' || action.expectedVersion === undefined) {
      setMessage('Сервер не предоставил безопасный способ выполнить действие');
      return false;
    }
    const online = typeof navigator === 'undefined' || navigator.onLine;
    if (!online && action.offlinePolicy === 'FORBIDDEN') {
      setMessage('Это действие нельзя выполнить без связи с сервером');
      return false;
    }
    if (!online && action.offlinePolicy === 'AUTHORIZED') {
      setMessage('Для этого действия требуется действующее подписанное разрешение работы без связи');
      return false;
    }

    const commandId = preparedCommandId ?? createOperatorCommandId();
    active.current = commandId;
    setBusyActionId(action.id);
    setMessage(`${action.label}: сохраняем на устройстве`);
    let queued = false;
    try {
      sequence.current += 1;
      const envelope = createOfflineCommandEnvelope({
        commandId,
        route: action.route,
        expectedVersion: action.expectedVersion,
        deviceId,
        deviceSequence: sequence.current,
        occurredAt: new Date().toISOString(),
        payload,
        aggregateId,
        attachmentIds: payloadAttachmentIds(payload),
      });
      await services.queue.enqueue(envelope);
      queued = true;
      setMessage(`${action.label}: сохранено на устройстве`);
      if (!online) return true;

      const report = await services.synchronizer.synchronize();
      const confirmed = report.confirmedCommands.find((item) => item.commandId === commandId);
      if (!confirmed) {
        setMessage(report.conflicts > 0 ? `${action.label}: требуется проверка` : `${action.label}: сохранено и ожидает передачи`);
        return true;
      }
      if (confirmed.workplace !== undefined) {
        try { acceptSnapshot(normalizeOperatorWorkplace(confirmed.workplace)); }
        catch { setMessage(`${action.label}: выполнено, обновите рабочее место`); return true; }
      }
      setMessage(`${action.label}: выполнено`);
      return true;
    } catch (error) {
      if (queued) {
        setMessage(`${action.label}: сохранено на устройстве и ожидает передачи`);
        return true;
      }
      setMessage(safeOperatorError(error));
      return false;
    } finally {
      active.current = null;
      setBusyActionId(null);
    }
  }, [acceptSnapshot, deviceId, services]);

  return {execute, busyActionId, message};
}
