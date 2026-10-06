/**
 * Чтение целочисленных настроек воркера из окружения (F-WORKER-ENV-INTS).
 *
 * Прежний шаблон `parseInt(process.env.X || 'N', 10)` пропускал мусор молча:
 * «abc» давало NaN, «0» и «-1» — неположительное число. Для таймеров это не
 * косметика: Node приводит NaN-задержку к 1 мс, поэтому setInterval крутился
 * бы без остановки и долбил базу, а нулевой дедлайн остановки срабатывал бы
 * сразу и обрывал работу через process.exit(1) вместо отведённых секунд.
 *
 * Здесь всё, что не целое или вне границ, откатывается к значению по умолчанию
 * и попадает в лог с именем переменной.
 */

import { logger } from '@/lib/logger';

/** Предел задержки таймера в Node: больше 2^31-1 setTimeout/setInterval не принимают. */
const MAX_TIMER_MS = 2 ** 31 - 1;

export function positiveIntEnv(
  name: string,
  fallback: number,
  limits: { min?: number; max?: number } = {},
): number {
  const { min = 1, max = MAX_TIMER_MS } = limits;
  const raw = process.env[name];

  // Пустая строка (и строка из пробелов) — это «переменная не задана»:
  // значение по умолчанию без предупреждения, как вёл себя прежний `|| 'N'`.
  if (raw === undefined || raw.trim() === '') return fallback;

  const value = Number(raw);

  if (!Number.isInteger(value) || value < min || value > max) {
    logger.warn('Invalid integer env value, using fallback', {
      name,
      value: raw,
      fallback,
      min,
      max,
    });
    return fallback;
  }

  return value;
}
