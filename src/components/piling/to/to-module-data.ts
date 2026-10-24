import { authFetch } from '@/lib/api';
import { type WorkPermitsPage } from './readiness/api/client';
import { isReadinessRequestCancelled } from './readiness/api/errors';

export interface WorkspaceIssue {
  source: string;
  message: string;
}

export async function readOptionalCollectionWithIssue<T>(
  url: string,
  field: 'data' | 'records',
  source: string,
): Promise<{ data: T[]; issue: WorkspaceIssue | null }> {
  const result = await readOptionalJsonWithIssue<Record<string, unknown>>(url, source);
  if (!result.data) return { data: [], issue: result.issue };
  return Array.isArray(result.data[field])
    ? { data: result.data[field] as T[], issue: null }
    : {
        data: [],
        issue: {
          source,
          message: 'Сервер вернул данные в неподдерживаемом формате.',
        },
      };
}

export async function readOptionalJsonWithIssue<T>(
  url: string,
  source: string,
): Promise<{ data: T | null; issue: WorkspaceIssue | null }> {
  try {
    const response = await authFetch(url);
    if (!response.ok) {
      return {
        data: null,
        issue: {
          source,
          message: response.status === 403
            ? 'Недостаточно прав для загрузки данных.'
            : response.status === 429
              ? 'Слишком много запросов. Повторите через минуту.'
              : `Источник временно недоступен (код ${response.status}).`,
        },
      };
    }
    return { data: await response.json() as T, issue: null };
  } catch {
    return {
      data: null,
      issue: {
        source,
        message: navigator.onLine
          ? 'Не удалось получить ответ от сервера.'
          : 'Нет подключения к сети.',
      },
    };
  }
}

export async function readAuthoritativeCollection<T>(
  request: Promise<T[]>,
): Promise<{data: T[]; error: string | null}> {
  try {
    return {data: await request, error: null};
  } catch (error) {
    return {
      data: [],
      error: error instanceof Error
        ? error.message
        : 'Авторитетная оценка недоступна.',
    };
  }
}

/**
 * При сбое чтения признаков готовности (смены, наряды, дефекты, аудит)
 * возвращает запасное значение и помечает проблему — страница продолжает
 * работать с частичными данными, но не выдаёт «всё чисто» за отсутствие данных.
 * Отменённый запрос пере-бросает: им занимается внешний обработчик загрузки.
 */
export const EMPTY_PERMITS_PAGE: WorkPermitsPage = { items: [], total: 0, hasMore: false, nextCursor: null };

export async function readReadinessPartial<T>(
  request: Promise<T>,
  fallback: T,
): Promise<{ data: T; failed: boolean }> {
  try {
    return { data: await request, failed: false };
  } catch (error) {
    if (isReadinessRequestCancelled(error)) throw error;
    return { data: fallback, failed: true };
  }
}
