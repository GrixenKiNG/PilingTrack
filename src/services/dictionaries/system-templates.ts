export function normalizeDictionaryName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
}

export const PILE_GRADE_TEMPLATES = [
  { name: 'СВ 120-35', code: 'СВ 120-35', lengthMm: 12_000 },
  { name: 'СВ 150-50', code: 'СВ 150-50', lengthMm: 15_000 },
  { name: 'СВ 200-60', code: 'СВ 200-60', lengthMm: 20_000 },
  { name: 'СВ 300-80', code: 'СВ 300-80', lengthMm: 30_000 },
  { name: 'СВ 400-100', code: 'СВ 400-100', lengthMm: 40_000 },
] as const;

export const DRILLING_TYPE_TEMPLATES = [
  { name: 'Лидерное бурение d=150мм' },
  { name: 'Лидерное бурение d=200мм' },
  { name: 'Расширение скважины' },
] as const;

export const DOWNTIME_REASON_TEMPLATES = [
  { name: 'Переезд установки' },
  { name: 'Плохие погодные условия' },
  { name: 'Отсутствие свай на складе' },
  { name: 'Ремонт установки' },
  { name: 'Ожидание техники' },
  { name: 'Прочее' },
] as const;

/**
 * Виды документов работника. Список утверждён владельцем 15.08.2026 и
 * задуман пополняемым: заказчик добавляет свои виды в справочнике, релиз для
 * этого не нужен.
 *
 * leadTimeDays — за сколько дней предупреждать об окончании срока. 30 против
 * семи у ТО: продление удостоверения занимает недели, а не день.
 */
export const USER_DOCUMENT_TYPE_TEMPLATES = [
  { name: 'Удостоверение машиниста копровой установки', defaultValidMonths: 60, leadTimeDays: 30 },
  { name: 'Медицинский осмотр', defaultValidMonths: 12, leadTimeDays: 30 },
  { name: 'Удостоверение по охране труда', defaultValidMonths: 36, leadTimeDays: 30 },
  { name: 'Аттестация по промышленной безопасности', defaultValidMonths: 60, leadTimeDays: 30 },
] as const;
