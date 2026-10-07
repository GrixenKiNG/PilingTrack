import {describe, expect, it} from 'vitest';
import {
  DOWNTIME_QUICK_HOURS, downtimeHoursProblem, formatDowntimeHoursOnly, isWholeDowntimeStep, parseDowntimeHours,
} from '../downtime-hours';

// Решение владельца 07.10.2026: простой машиниста — только часы, без привязки ко
// времени работы в программе.
describe('parseDowntimeHours — часы из поля', () => {
  it.each([
    ['1', 1], ['1.5', 1.5], ['1,5', 1.5], ['0,25', 0.25], ['0.75', 0.75], ['24', 24], [' 2 ', 2], ['2,75', 2.75],
  ])('«%s» → %s', (text, hours) => {
    expect(parseDowntimeHours(text)).toBe(hours);
  });

  it.each([
    [''], ['  '], ['abc'], ['1,3'], ['0,1'], ['0'], ['-1'], ['24,25'], ['25'], ['1.5.2'], ['1 ч'], ['1e1'], [',5'],
  ])('«%s» не принимается', (text) => {
    expect(parseDowntimeHours(text)).toBeNull();
  });
});

describe('isWholeDowntimeStep', () => {
  it('кратно четверти часа', () => {
    expect(isWholeDowntimeStep(0.25)).toBe(true);
    expect(isWholeDowntimeStep(3.5)).toBe(true);
    expect(isWholeDowntimeStep(0.3)).toBe(false);
    expect(isWholeDowntimeStep(Number.NaN)).toBe(false);
  });
});

describe('downtimeHoursProblem — подсказка под полем', () => {
  it('молчит, пока поле пусто или значение допустимо', () => {
    expect(downtimeHoursProblem('')).toBeNull();
    expect(downtimeHoursProblem('1,5')).toBeNull();
  });

  it('называет правило, когда значение недопустимо', () => {
    expect(downtimeHoursProblem('1,3')).toMatch(/четверть часа/);
    expect(downtimeHoursProblem('99')).toMatch(/от 0,25 до 24/);
  });
});

describe('formatDowntimeHoursOnly — только часы, без минут', () => {
  it.each([[0.25, '0,25 ч'], [0.5, '0,5 ч'], [1, '1 ч'], [1.5, '1,5 ч'], [2.75, '2,75 ч'], [24, '24 ч']])(
    '%s → «%s»', (hours, text) => expect(formatDowntimeHoursOnly(hours)).toBe(text),
  );

  it('пусто и нуль — «0 ч»', () => {
    expect(formatDowntimeHoursOnly(null)).toBe('0 ч');
    expect(formatDowntimeHoursOnly(undefined)).toBe('0 ч');
    expect(formatDowntimeHoursOnly(0)).toBe('0 ч');
  });

  it('никогда не пишет минуты', () => {
    for (const hours of [0.25, 0.5, 1.25, 7.75]) expect(formatDowntimeHoursOnly(hours)).not.toMatch(/мин/);
  });
});

describe('DOWNTIME_QUICK_HOURS', () => {
  it('быстрые кнопки сами проходят проверку формы', () => {
    for (const hours of DOWNTIME_QUICK_HOURS) expect(parseDowntimeHours(String(hours))).toBe(hours);
  });
});
