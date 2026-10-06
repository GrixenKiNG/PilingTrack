/**
 * Тексты отказов для экранов осмотров: список, карточка, шаблоны, фото.
 *
 * Экран не вправе выдавать отказ за «данных нет»: список осмотров на 403/5xx
 * писал «Осмотров не найдено.», карточка на любом сбое — «Осмотр не найден.»,
 * а сохранение показывало серверную английскую строку как есть (R100, важно
 * №1/№2/№6). Причина различается по статусу; обрыв связи не путается с
 * ответом сервера.
 */

import { apiErrorMessage } from '@/lib/api-error-message';

/** Сбой связи — не ответ сервера: уведомление объясняет, что делать. */
export const NETWORK_ERROR = 'Нет соединения с сервером. Проверьте связь и повторите.';

/** Отказ чтения: статус сервера, либо `null` при обрыве связи. */
export class InspectionLoadError extends Error {
  constructor(readonly status: number | null) {
    super('inspection load failed');
    this.name = 'InspectionLoadError';
  }
}

/** Тело отказа, если оно читается; иначе `undefined` (обрыв/не-JSON ответ). */
async function readErrorBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

/**
 * Текст отказа мутации (сохранение черновика, завершение осмотра).
 *
 * 401 и ошибка CSRF приходят английскими («Unauthorized», «CSRF validation
 * failed: …») — на русском экране они заменяются понятной формулировкой.
 * Остальное берётся из тела ответа: там либо серверный русский текст (400/409
 * по делу), либо построчные `details`; нечитаемое тело (прокси, шлюз) даёт
 * фолбэк вместо браузерного «Unexpected end of JSON input».
 */
export async function extractApiError(res: Response, fallback: string): Promise<string> {
  if (res.status === 401) return 'Сессия истекла — войдите снова.';
  const message = apiErrorMessage(await readErrorBody(res), fallback);
  if (res.status === 403 && message.startsWith('CSRF validation failed')) {
    return 'Запрос отклонён проверкой безопасности. Обновите страницу и повторите.';
  }
  return message;
}

/** Текст тоста из пойманного исключения: обрыв сети `fetch` бросает `TypeError`. */
export function catchText(cause: unknown, fallback: string): string {
  if (cause instanceof TypeError) return NETWORK_ERROR;
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

/** Текст отказа чтения. 403 и 404 у каждого экрана свои — их передаёт вызывающий. */
export function loadErrorText(
  cause: unknown,
  texts: { forbidden: string; notFound: string; server: string },
): string {
  if (!(cause instanceof InspectionLoadError)) return NETWORK_ERROR;
  if (cause.status === null) return NETWORK_ERROR;
  if (cause.status === 403) return texts.forbidden;
  if (cause.status === 404) return texts.notFound;
  return texts.server;
}

/** Повтор помогает при обрыве связи и 5xx; 403/404 повтором не лечатся. */
export function isRetryableLoadError(cause: unknown): boolean {
  return !(cause instanceof InspectionLoadError) || cause.status === null || cause.status >= 500;
}
