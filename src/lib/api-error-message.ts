/**
 * Текст отказа API для формы — вместе с построчными ошибками полей.
 *
 * Сервер возвращает 400/422 двумя формами `details`: массив `{field, message}`
 * (`src/app/api/reports/upsert/route.ts`) и zod-`fieldErrors`
 * (`src/app/api/reports/admin-upsert/route.ts`). Формы читали только
 * `body.error`, поэтому отказ на одном поле выглядел как общее
 * «Некорректные данные» и человек правил поля наугад.
 *
 * В ответе приходят технические пути (`piles.0.count`) и английские тексты
 * zod по умолчанию: строка переводится в читаемый вид по картам ниже,
 * незнакомые путь и текст остаются как есть.
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

// Поля формы отчёта — пути из `reportUpsertSchema` / `reportAdminUpsertSchema`
// (src/lib/validation-schemas.ts), которые проверяют оба маршрута.
const REPORT_FIELD_LABELS: Record<string, string> = {
  siteId: 'Объект',
  date: 'Дата',
  shiftStart: 'Начало смены',
  shiftEnd: 'Конец смены',
  shiftType: 'Смена',
  equipmentId: 'Установка',
  engineHours: 'Моточасы',
};

// Построчные разделы: путь вида `piles.0.count` → «Сваи, строка 1: количество».
const REPORT_LINE_SECTIONS: Record<string, { label: string; fields: Record<string, string> }> = {
  piles: { label: 'Сваи', fields: { pileGradeId: 'марка', count: 'количество' } },
  drillings: {
    label: 'Бурение',
    fields: { typeId: 'вид', count: 'количество', metersPerUnit: 'метров за единицу', meters: 'метры', diameter: 'диаметр' },
  },
  downtimes: { label: 'Простой', fields: { reasonId: 'причина', duration: 'длительность' } },
};

// Тексты zod по умолчанию — сверяются по началу строки.
const MESSAGE_TRANSLATIONS: Array<[prefix: string, ru: string]> = [
  ['Expected number', 'ожидается число'],
  ['Number must be greater than or equal to 0', 'должно быть не меньше 0'],
  ['String must contain at least 1 character(s)', 'не заполнено'],
  ['Required', 'обязательное поле'],
  ['Invalid input', 'некорректное значение'],
];

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
  const text = translateMessage(message);
  if (typeof field !== 'string' || !field) return text;

  const label = fieldLabel(field);
  return label ? `${label}: ${text}` : `Поле ${field}: ${text}`;
}

function fieldLabel(field: string): string | undefined {
  const direct = REPORT_FIELD_LABELS[field];
  if (direct) return direct;

  const match = /^([a-zA-Z]+)\.(\d+)\.([a-zA-Z]+)$/.exec(field);
  if (!match) return undefined;

  const [, section, index, name] = match;
  const group = REPORT_LINE_SECTIONS[section];
  const label = group?.fields[name];
  return group && label ? `${group.label}, строка ${Number(index) + 1}: ${label}` : undefined;
}

function translateMessage(message: string): string {
  for (const [prefix, ru] of MESSAGE_TRANSLATIONS) {
    if (message.startsWith(prefix)) return ru;
  }
  return message;
}
