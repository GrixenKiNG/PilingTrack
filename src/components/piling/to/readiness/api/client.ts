import { authFetch } from '@/lib/api';
import type { ActingRole } from '@/lib/types';
import {
  isReadinessBootstrapEnvelope,
  parseCurrentReadinessResponse,
  parseReadinessHistoryResponse,
  type ReadinessBootstrap,
  type CurrentReadinessDto,
  type ReadinessAuditEnvelope,
  type ReadinessShiftDto,
  type ReadinessSnapshotDto,
  type WorkPermitDto,
} from './contracts';
import {
  ReadinessApiError,
  ReadinessRequestCancelledError,
  isReadinessRequestCancelled,
} from './errors';
import {
  createReadinessRequestId,
  READINESS_REQUEST_ID_HEADER,
} from './idempotency';

interface FetchReadinessBootstrapOptions {
  signal?: AbortSignal;
  requestId?: string;
  /** Роль, от имени которой администратор временно работает. */
  actingAs?: ActingRole;
}

export interface ReadinessUrlFilters {
  status?: string;
  from?: string;
  to?: string;
  shiftType?: 'DAY' | 'NIGHT';
  risk?: 'NORMAL' | 'ELEVATED';
  eventType?: string;
  actor?: string;
  equipmentId?: string;
}

export function readinessFilterQuery(filters: ReadinessUrlFilters = {}): string {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params.toString();
}

function messageFromBody(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const error = (body as Record<string, unknown>).error;
  return typeof error === 'string' && error.length > 0 ? error : null;
}

function responseError(status: number, message: string, requestId: string | null) {
  if (status === 401) {
    return new ReadinessApiError('UNAUTHORIZED', 'Сессия завершена. Войдите повторно.', status, requestId);
  }
  if (status === 403) {
    return new ReadinessApiError('FORBIDDEN', 'Недостаточно прав для центра технической готовности.', status, requestId);
  }
  if (status === 429) {
    return new ReadinessApiError('RATE_LIMITED', 'Слишком много запросов. Повторите через минуту.', status, requestId);
  }
  if (status >= 500) {
    return new ReadinessApiError('UNAVAILABLE', message || 'Сервис технической готовности временно недоступен.', status, requestId);
  }
  return new ReadinessApiError('REQUEST_FAILED', message || `Запрос завершился с кодом ${status}.`, status, requestId);
}

export async function fetchReadinessBootstrap(
  options: FetchReadinessBootstrapOptions = {},
): Promise<ReadinessBootstrap> {
  if (options.signal?.aborted) throw new ReadinessRequestCancelledError();
  const requestId = options.requestId ?? createReadinessRequestId();
  let response: Response;
  try {
    response = await authFetch(`/api/readiness/bootstrap${options.actingAs ? `?actingAs=${options.actingAs}` : ''}`, {
      method: 'GET',
      signal: options.signal,
      headers: { [READINESS_REQUEST_ID_HEADER]: requestId },
    });
  } catch (error) {
    if (isReadinessRequestCancelled(error) || options.signal?.aborted) {
      throw new ReadinessRequestCancelledError();
    }
    throw new ReadinessApiError(
      'REQUEST_FAILED',
      typeof navigator !== 'undefined' && !navigator.onLine
        ? 'Нет подключения к сети.'
        : 'Не удалось получить ответ сервера.',
      null,
      requestId,
    );
  }

  const responseRequestId = response.headers.get(READINESS_REQUEST_ID_HEADER) ?? requestId;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ReadinessApiError(
      'INVALID_RESPONSE',
      'Сервер вернул неподдерживаемый ответ.',
      response.status,
      responseRequestId,
    );
  }

  if (!response.ok) {
    throw responseError(
      response.status,
      messageFromBody(body) ?? '',
      responseRequestId,
    );
  }
  if (!isReadinessBootstrapEnvelope(body)) {
    throw new ReadinessApiError(
      'INVALID_RESPONSE',
      'Сервер вернул неполный контракт технической готовности.',
      response.status,
      responseRequestId,
    );
  }
  if (body.meta.requestId !== responseRequestId) {
    throw new ReadinessApiError(
      'INVALID_RESPONSE',
      'Не удалось сопоставить ответ с запросом.',
      response.status,
      responseRequestId,
    );
  }
  return body.data;
}

async function fetchReadinessJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await authFetch(url, { signal });
  const requestId = response.headers.get(READINESS_REQUEST_ID_HEADER);
  const body = await response.json().catch(() => null) as T | null;
  if (!response.ok) throw responseError(response.status, messageFromBody(body) ?? '', requestId);
  if (body === null) throw new ReadinessApiError('INVALID_RESPONSE', 'Сервер вернул пустой ответ.', response.status, requestId);
  return body;
}

export async function fetchReadinessShifts(signal?: AbortSignal, filters: ReadinessUrlFilters = {}): Promise<ReadinessShiftDto[]> {
  const query = readinessFilterQuery(filters);
  const body = await fetchReadinessJson<{ data?: ReadinessShiftDto[] }>(`/api/readiness/shifts?limit=200${query ? `&${query}` : ''}`, signal);
  return Array.isArray(body.data) ? body.data : [];
}

export async function fetchWorkPermits(signal?: AbortSignal, filters: ReadinessUrlFilters = {}): Promise<WorkPermitDto[]> {
  const query = readinessFilterQuery(filters);
  const body = await fetchReadinessJson<{ data?: WorkPermitDto[] }>(`/api/readiness/work-permits?limit=200${query ? `&${query}` : ''}`, signal);
  return Array.isArray(body.data) ? body.data : [];
}

export async function fetchCurrentReadiness(signal?: AbortSignal, filters: ReadinessUrlFilters = {}): Promise<CurrentReadinessDto[]> {
  const params = new URLSearchParams();
  if (filters.equipmentId) params.set('equipmentId', filters.equipmentId);
  const body = await fetchReadinessJson<unknown>(`/api/readiness/current${params.size ? `?${params}` : ''}`, signal);
  try {
    return parseCurrentReadinessResponse(body);
  } catch {
    throw new ReadinessApiError(
      'INVALID_RESPONSE',
      'Сервер вернул некорректный контракт авторитетной оценки готовности.',
    );
  }
}

export async function fetchReadinessHistory(signal?: AbortSignal, filters: ReadinessUrlFilters = {}): Promise<ReadinessSnapshotDto[]> {
  const query = readinessFilterQuery(filters);
  const body = await fetchReadinessJson<unknown>(`/api/readiness/history?limit=500${query ? `&${query}` : ''}`, signal);
  try {
    return parseReadinessHistoryResponse(body);
  } catch {
    throw new ReadinessApiError(
      'INVALID_RESPONSE',
      'Сервер вернул некорректный контракт истории готовности.',
    );
  }
}

export async function fetchReadinessAudit(signal?: AbortSignal, filters: ReadinessUrlFilters = {}): Promise<ReadinessAuditEnvelope> {
  const auditFilters = {eventType: filters.eventType, actor: filters.actor, from: filters.from, to: filters.to};
  const query = readinessFilterQuery(auditFilters);
  return fetchReadinessJson<ReadinessAuditEnvelope>(`/api/readiness/audit?limit=500${query ? `&${query}` : ''}`, signal);
}
