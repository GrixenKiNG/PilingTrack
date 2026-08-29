import {OperatorV3ApiError} from './api-error';
import type {OperatorWorkplace} from './contracts';
import {normalizeOperatorWorkplace} from './normalize-workplace';

interface ErrorBody {code?: unknown; message?: unknown}

export async function fetchOperatorWorkplace(signal?: AbortSignal): Promise<OperatorWorkplace> {
  const response = await fetch('/api/operator/v3/workplace', {
    method: 'GET', credentials: 'same-origin', cache: 'no-store', signal,
    headers: {accept: 'application/json'},
  });
  const body = await response.json().catch(() => null) as {data?: unknown} & ErrorBody | null;
  if (!response.ok) {
    const message = typeof body?.message === 'string'
      ? body.message
      : 'Не удалось получить рабочее место оператора';
    throw new OperatorV3ApiError(message, typeof body?.code === 'string' ? body.code : 'ОШИБКА_ЗАПРОСА', response.status);
  }
  return normalizeOperatorWorkplace(body?.data);
}
