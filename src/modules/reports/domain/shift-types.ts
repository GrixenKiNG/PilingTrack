/**
 * Какие смены можно завести.
 *
 * ПОЧЕМУ ОДНА. У организации сейчас работает только дневная смена. Ночная
 * оставалась в списках как выбор, которого никто не делает: лишняя кнопка на
 * экране приёма установки и лишний вариант в фильтрах, где он всегда даёт
 * пусто.
 *
 * ПОЧЕМУ НЕ УДАЛЕНО ИЗ КОДА. Значение `NIGHT` остаётся в схеме, в подписях и в
 * истории: семь смен и один отчёт уже записаны ночными, и стереть тип означало
 * бы показать их без названия. Включить ночную обратно — вернуть её в этот
 * список; больше нигде трогать ничего не нужно.
 */
export const SHIFT_TYPES = ['DAY', 'NIGHT'] as const;
export type ShiftTypeValue = (typeof SHIFT_TYPES)[number];

/** То, что предлагают человеку при заведении смены и в фильтрах. */
export const SELECTABLE_SHIFT_TYPES: readonly ShiftTypeValue[] = ['DAY'];

export function isShiftTypeSelectable(type: string): boolean {
  return SELECTABLE_SHIFT_TYPES.includes(type as ShiftTypeValue);
}
