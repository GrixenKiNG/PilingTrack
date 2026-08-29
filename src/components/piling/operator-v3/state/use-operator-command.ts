'use client';

import {useCallback, useRef, useState} from 'react';
import type {OperatorAction, OperatorWorkplace} from '../api/contracts';
import {OperatorV3ApiError, safeOperatorError} from '../api/api-error';
import {buildOperatorCommandRequest} from '../api/action-registry';
import {createOperatorCommandId} from '../api/action-registry';
import {normalizeOperatorWorkplace} from '../api/normalize-workplace';

function deviceId() {
  if (typeof window === 'undefined') return 'сервер';
  const key = 'pilingtrack-operator-v3-device';
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const value = createOperatorCommandId();
  window.localStorage.setItem(key, value);
  return value;
}

export function useOperatorCommand(acceptSnapshot: (snapshot: OperatorWorkplace) => void) {
  const sequence = useRef(0);
  const active = useRef<string | null>(null);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const execute = useCallback(async (action: OperatorAction, payload: Record<string, unknown> = {}, preparedCommandId?: string, aggregateId?: string) => {
    if (active.current) return false;
    if (action.kind !== 'COMMAND') {
      setMessage(`${action.label}. Откройте форму действия на текущем этапе`);
      return false;
    }
    const id = preparedCommandId ?? createOperatorCommandId();
    active.current = id;
    setBusyActionId(action.id);
    setMessage(`${action.label}: выполняется`);
    try {
      sequence.current += 1;
      const request = buildOperatorCommandRequest(action, {
        commandId: id, deviceId: deviceId(), deviceSequence: sequence.current,
        occurredAt: new Date().toISOString(), payload, aggregateId,
      });
      const response = await fetch(request.route, {method: request.method, headers: request.headers, body: request.body, credentials: 'same-origin'});
      const body = await response.json().catch(() => null) as {workplace?: unknown; data?: {workplace?: unknown}; message?: unknown; code?: unknown} | null;
      if (!response.ok) {
        throw new OperatorV3ApiError(typeof body?.message === 'string' ? body.message : 'Действие не выполнено', typeof body?.code === 'string' ? body.code : 'ОШИБКА_КОМАНДЫ', response.status);
      }
      const workplace = normalizeOperatorWorkplace(body?.workplace ?? body?.data?.workplace);
      acceptSnapshot(workplace);
      setMessage(`${action.label}: выполнено`);
      return true;
    } catch (error) {
      setMessage(safeOperatorError(error));
      return false;
    } finally {
      active.current = null;
      setBusyActionId(null);
    }
  }, [acceptSnapshot]);

  return {execute, busyActionId, message};
}
