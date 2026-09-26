/**
 * Текст отказа API для формы — вместе с построчными ошибками полей.
 *
 * Сервер возвращает 400/422 двумя формами `details`: массив `{field, message}`
 * (`src/app/api/reports/upsert/route.ts`) и zod-`fieldErrors`
 * (`src/app/api/reports/admin-upsert/route.ts`). Формы читали только
 * `body.error`, поэтому отказ на одном поле выглядел как общее
 * «Некорректные данные» и человек правил поля наугад.
 *
 * Чистая функция: тело ответа уже прочитано вызывающим.
 */
export function apiErrorMessage(body: unknown, fallback: string): string {
  if (typeof body !== 'object' || body === null) return fallback;

  const { error, details } = body as { error?: unknown; details?: unknown };
  const headline = typeof error === 'string' && error ? error : fallback;
  const lines = fieldMessages(details).slice(0, 3);
  if (lines.length === 0) return headline;

  return [headline, ...lines].join('\n');
}

function fieldMessages(details: unknown): string[] {
  if (Array.isArray(details)) {
    return details.flatMap((entry) => {
      if (typeof entry !== 'object' || entry === null) return [];
      const { field, message } = entry as { field?: unknown; message?: unknown };
      if (typeof message !== 'string' || !message) return [];
      return [formatLine(field, message)];
    });
  }

  if (typeof details === 'object' && details !== null) {
    const { fieldErrors } = details as { fieldErrors?: unknown };
    if (typeof fieldErrors !== 'object' || fieldErrors === null) return [];
    return Object.entries(fieldErrors as Record<string, unknown>).flatMap(([field, messages]) => {
      const first = Array.isArray(messages) ? messages.find((m) => typeof m === 'string' && m) : undefined;
      return typeof first === 'string' ? [formatLine(field, first)] : [];
    });
  }

  return [];
}

function formatLine(field: unknown, message: string): string {
  return typeof field === 'string' && field ? `Поле ${field}: ${message}` : message;
}
