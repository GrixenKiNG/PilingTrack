/**
 * Тексты отказов для экрана бригад (src/components/piling/admin-crews).
 *
 * Экран не вправе показывать сырой ответ сервера: обрыв связи приходит
 * браузерным «Failed to fetch», истёкшая сессия — английским «Unauthorized»,
 * CSRF-403 — технической строкой «CSRF validation failed: …», а 400 несёт
 * построчные `details`, которые раньше отбрасывались (R102, важно №4–№6, №10).
 * Здесь эти ответы переводятся в понятный русский текст; обрыв сети не
 * путается с ответом сервера.
 */

import { apiErrorMessage } from '@/lib/api-error-message';

/** Сбой связи — не ответ сервера: уведомление объясняет, что делать. */
export const NETWORK_ERROR = 'Нет соединения с сервером. Проверьте связь и повторите.';

/** Тело отказа, если оно читается; иначе `undefined` (обрыв/не-JSON ответ). */
async function readErrorBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

/**
 * Текст отказа мутации (создание/правка/деактивация).
 *
 * 401 и ошибка CSRF приходят английскими — заменяются понятной формулировкой;
 * остальное берётся из тела (`error` и построчные `details` через
 * `apiErrorMessage`). Нечитаемое тело (прокси, шлюз) даёт фолбэк.
 */
export async function extractApiError(res: Response, fallback: string): Promise<string> {
  if (res.status === 401) return 'Сессия истекла — войдите снова.';
  const message = apiErrorMessage(await readErrorBody(res), fallback);
  if (res.status === 403 && message.startsWith('CSRF validation failed')) {
    return 'Запрос отклонён проверкой безопасности. Обновите страницу и повторите.';
  }
  return message;
}

/** Текст из пойманного исключения: обрыв сети `fetch` бросает `TypeError`. */
export function catchText(cause: unknown, fallback: string): string {
  if (cause instanceof TypeError) return NETWORK_ERROR;
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
