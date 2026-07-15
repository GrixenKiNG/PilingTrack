import { usePilingStore } from '@/lib/store';
import { pushClientFeedback } from '@/lib/client-feedback';
import type { UserRole } from '@/lib/types';

function buildHeaders(options: RequestInit) {
  const headers = new Headers(options.headers || {});
  const body = options.body;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  if (!headers.has('Content-Type') && body && !isFormData) {
    headers.set('Content-Type', 'application/json');
  }

  return headers;
}

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers: buildHeaders(options),
      credentials: 'same-origin',
    });
  } catch (error) {
    if (!url.includes('/api/feedback/events')) {
      pushClientFeedback({
        level: 'error',
        priority: 'CRITICAL',
        scope: 'network',
        action: 'network.request_failed',
        title: 'Сетевой сбой',
        message: `Не удалось выполнить запрос ${options.method || 'GET'} ${url}.`,
        metadata: {
          method: options.method || 'GET',
          url,
          error: error instanceof Error ? error.message : 'unknown',
        },
      });
    }

    throw error;
  }

  if (res.status === 401) {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
    } catch {
      // Ignore cleanup failures and still drop local session state.
    }

    if (usePilingStore.getState().currentUser) {
      usePilingStore.getState().logout();
    }
  }

  if (res.status >= 500 && !url.includes('/api/feedback/events')) {
    pushClientFeedback({
      level: 'error',
      priority: 'HIGH',
      scope: 'api',
      action: 'api.request_failed',
      title: 'Серверная ошибка',
      message: `Запрос ${options.method || 'GET'} ${url} завершился со статусом ${res.status}.`,
      requestId: res.headers.get('x-request-id'),
      metadata: {
        method: options.method || 'GET',
        url,
        status: res.status,
      },
      persist: true,
    });
  }

  return res;
}

export async function logoutClient() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
    });
  } finally {
    usePilingStore.getState().logout();
  }
}

type SessionUser = { id: string; email: string; name: string; role: UserRole };

/**
 * Результат проверки сессии. Три состояния, а не два: «не смогли проверить»
 * (сеть/5xx) — это НЕ то же самое, что «сессии нет».
 */
export type SessionProbe =
  | { status: 'authenticated'; user: SessionUser }
  | { status: 'anonymous' }
  | { status: 'unknown' };

/**
 * Проверяет сессию через /api/auth/me.
 *
 * Раньше здесь было `if (!res.ok) return null`, и вызывающий код трактовал
 * null как «сессии нет» → принудительный logout + редирект на /login. Но 500
 * (auth.ts отдаёт его на ЛЮБОЙ сбой БД) и сетевой обрыв попадали в ту же ветку,
 * поэтому короткого моргания БД хватало, чтобы выкинуть работающего оператора
 * из приложения. Явно разделяем «сервер сказал 401» и «проверить не удалось»:
 * на 'unknown' сессию трогать нельзя.
 */
export async function probeSession(): Promise<SessionProbe> {
  let res: Response;
  try {
    res = await fetch('/api/auth/me', { credentials: 'same-origin' });
  } catch {
    return { status: 'unknown' };
  }

  if (res.status === 401) return { status: 'anonymous' };
  if (!res.ok) return { status: 'unknown' };

  try {
    const data = (await res.json()) as { user?: SessionUser };
    return data.user ? { status: 'authenticated', user: data.user } : { status: 'anonymous' };
  } catch {
    return { status: 'unknown' };
  }
}

export function authGet(url: string) {
  return authFetch(url, { method: 'GET' });
}

export function authPost(url: string, body: unknown) {
  return authFetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function authPut(url: string, body: unknown) {
  return authFetch(url, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}
