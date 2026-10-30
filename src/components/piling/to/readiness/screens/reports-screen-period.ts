import { type ReadinessUrlFilters } from '../api/client';

/** Период отчёта по умолчанию, если фильтр дат не задан. */
const REPORT_DEFAULT_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * Календарный день тенанта для момента времени, «ГГГГ-ММ-ДД».
 *
 * Границы периода считаем днями тенанта, а не мгновениями по часам браузера.
 * Раньше здесь стоял `new Date('2026-07-13T00:00:00')` — это полночь у того,
 * кто смотрит. Сервер при этом разбирает те же даты в поясе тенанта
 * (`parseReadinessReadFilters`), и у пользователя не в Москве серверная
 * выборка и клиентский отбор разъезжались на сутки по краям окна.
 */
export const tenantDay = (value: Date | string, timezone: string): string =>
  new Date(value).toLocaleDateString('en-CA', { timeZone: timezone });

/** День как UTC-полночь: арифметика по календарю, без перевода часов. */
export const dayToUtc = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

export const shiftDay = (day: string, delta: number): string =>
  new Date(dayToUtc(day).getTime() + delta * DAY_MS).toISOString().slice(0, 10);

/** Дата тенанта человеку. Формат в UTC — день уже календарный, сдвигать нечего. */
export const formatTenantDay = (day: string): string =>
  new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeZone: 'UTC' }).format(dayToUtc(day));

/**
 * Окно отчёта и равное ему предыдущее окно — для сравнений «к предыдущему
 * периоду». Сравнивать не с чем, если в прошлом окне данных нет: тогда дельту
 * не показываем вовсе, а не рисуем ноль или прочерк со стрелкой.
 */
export function resolveReportPeriod(filters: ReadinessUrlFilters, timezone: string) {
  const toDay = filters.to || tenantDay(new Date(), timezone);
  const fromDay = filters.from || shiftDay(toDay, -(REPORT_DEFAULT_DAYS - 1));
  const days = Math.max(
    1,
    Math.round((dayToUtc(toDay).getTime() - dayToUtc(fromDay).getTime()) / DAY_MS) + 1,
  );
  return {
    fromDay,
    toDay,
    days,
    previousFromDay: shiftDay(fromDay, -days),
    previousToDay: shiftDay(fromDay, -1),
  };
}

export const average = (values: readonly number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

/**
 * Подпись дельты: знак, единица и оговорка про базу сравнения. Единица
 * необязательна — у счётчиков её нет, иначе выходит «+12 к к предыдущему».
 */
export function deltaDetail(current: number | null, previous: number | null, unit?: string): string | undefined {
  if (current == null || previous == null) return undefined;
  const diff = Math.round((current - previous) * 10) / 10;
  if (diff === 0) return 'без изменений к предыдущему периоду';
  return `${diff > 0 ? '+' : '−'}${Math.abs(diff)}${unit ? ` ${unit}` : ''} к предыдущему периоду`;
}
