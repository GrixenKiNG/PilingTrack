import { describe, it, expect } from 'vitest';
import {
  downtimeHoursBetween,
  formatDowntimeHours,
  DOWNTIME_MAX_HOURS,
} from '@/lib/downtime-hours';

/**
 * Контракт (src/lib/downtime-hours.ts):
 * - длительность = интервал, а не округлённое число часов; считает сервер;
 * - конец раньше начала — переход через полночь, +1 сутки, а не ошибка;
 * - DOWNTIME_MAX_HOURS = 24 — это лишь граница валидации ввода, сам расчёт не режет;
 * - формат обязан совпадать на каждом экране: часы и минуты, без секунд.
 */
describe('downtimeHoursBetween', () => {
  it('возвращает целый час для часового интервала без округления', () => {
    const start = new Date('2026-09-25T10:00:00');
    const end = new Date('2026-09-25T11:00:00');
    expect(downtimeHoursBetween(start, end)).toBe(1);
  });

  it('сохраняет дробную длительность (полчаса = 0.5)', () => {
    const start = new Date('2026-09-25T10:20:00');
    const end = new Date('2026-09-25T10:50:00');
    expect(downtimeHoursBetween(start, end)).toBe(0.5);
  });

  it('переход через полночь нормализуется прибавлением суток', () => {
    const start = new Date('2026-09-25T23:00:00');
    const end = new Date('2026-09-26T01:00:00');
    expect(downtimeHoursBetween(start, end)).toBe(2);
  });

  it('дробный переход через полночь считается правильно', () => {
    const start = new Date('2026-09-25T22:30:00');
    const end = new Date('2026-09-26T00:15:00');
    expect(downtimeHoursBetween(start, end)).toBe(1.75);
  });

  it('нулевая длительность даёт 0', () => {
    const moment = new Date('2026-09-25T10:00:00');
    expect(downtimeHoursBetween(moment, new Date(moment.getTime()))).toBe(0);
  });

  it('конец раньше начала трактуется как +1 сутки, а не как ошибка', () => {
    const start = new Date('2026-09-25T10:00:00');
    const end = new Date('2026-09-25T09:00:00');
    expect(downtimeHoursBetween(start, end)).toBe(23);
  });

  it('интервал выше максимального допустимого не режется расчётом', () => {
    expect(DOWNTIME_MAX_HOURS).toBe(24);
    const start = new Date('2026-09-25T10:00:00');
    const end = new Date('2026-09-26T12:00:00');
    expect(downtimeHoursBetween(start, end)).toBe(26);
  });
});

describe('formatDowntimeHours', () => {
  it('null/undefined/0 и неположительные значения дают "0 ч"', () => {
    expect(formatDowntimeHours(null)).toBe('0 ч');
    expect(formatDowntimeHours(undefined)).toBe('0 ч');
    expect(formatDowntimeHours(0)).toBe('0 ч');
    expect(formatDowntimeHours(-2)).toBe('0 ч');
  });

  it('дробное значение меньше часа показан в минутах с округлением', () => {
    expect(formatDowntimeHours(0.5)).toBe('30 мин');
    expect(formatDowntimeHours(0.99)).toBe('59 мин');
  });

  it('часы и минуты вместе', () => {
    expect(formatDowntimeHours(1.5)).toBe('1 ч 30 мин');
    expect(formatDowntimeHours(1.25)).toBe('1 ч 15 мин');
  });

  it('целые часы без минут', () => {
    expect(formatDowntimeHours(2)).toBe('2 ч');
  });

  it('крупное значение (выше суток) форматируется, а не обрезается', () => {
    expect(formatDowntimeHours(24.5)).toBe('24 ч 30 мин');
  });
});
