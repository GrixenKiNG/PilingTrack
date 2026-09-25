import { describe, it, expect, vi } from 'vitest';

// computeFuelConsumption — чистая функция, базу не трогает, но про import
// fuel-log.ts подтягивается и `@/lib/db` на верхнем уровне модуля, поэтому
// его надо заглушить, как в соседних спеках этой папки.
vi.mock('@/lib/db', () => {
  const client = {
    equipment: { findUnique: vi.fn() },
    fuelLog: {
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
  };
  return { db: client };
});

import { computeFuelConsumption } from '../fuel-log';

// Правило расхода: «сожгли = долили + (было в баке − осталось)». «Было −
// осталось» выводится из процентов указателя и объёма бака. Без объёма бака
// или хотя бы одного замера остатка расход неизвестен — честный null, а не ноль.
describe('computeFuelConsumption — расход топлива', () => {
  it('обычный день: старт 80 %, конец 50 %, долито 100 л, бак 400 л', () => {
    // Было − осталось = 400 · (80 − 50) / 100 = 120 л. Расход = 100 + 120 = 220 л.
    const r = computeFuelConsumption({
      tankLiters: 400, startPercent: 80, endPercent: 50, litersAdded: 100, engineHoursDelta: 5,
    });
    expect(r.consumedLiters).toBe(220);
    // 220 / 5 = 44 л/моточас.
    expect(r.perEngineHour).toBe(44);
  });

  it('без долива расход равен уменьшению запаса в баке', () => {
    // 400 · (80 − 50) / 100 = 120 л, долив 0.
    const r = computeFuelConsumption({
      tankLiters: 400, startPercent: 80, endPercent: 50, litersAdded: 0, engineHoursDelta: null,
    });
    expect(r.consumedLiters).toBe(120);
    // Моточасов нет — расход на моточас не считаем.
    expect(r.perEngineHour).toBeNull();
  });

  it('долив больше, чем изменение уровня: уровни уже пересчитываются в объём', () => {
    // Было − осталось = 400 · (40 − 70) / 100 = −120 л (уровень вырос).
    // Расход = 100 + (−120) = −20 л — отрицательный, значит в бак либо долили
    // неучтённого раньше, либо осчётчился замер. На моточас не делим.
    const r = computeFuelConsumption({
      tankLiters: 400, startPercent: 40, endPercent: 70, litersAdded: 100, engineHoursDelta: 4,
    });
    expect(r.consumedLiters).toBe(-20);
    expect(r.perEngineHour).toBeNull();
  });

  it('нет объёма бака — расход неизвестен (null, а не ноль)', () => {
    const r = computeFuelConsumption({
      tankLiters: null, startPercent: 80, endPercent: 50, litersAdded: 100, engineHoursDelta: 5,
    });
    expect(r.consumedLiters).toBeNull();
    expect(r.perEngineHour).toBeNull();
  });

  it('проценты нельзя вывести без одного из замеров остатка', () => {
    const noStart = computeFuelConsumption({
      tankLiters: 400, startPercent: null, endPercent: 50, litersAdded: 100, engineHoursDelta: 5,
    });
    expect(noStart.consumedLiters).toBeNull();
    expect(noStart.perEngineHour).toBeNull();

    const noEnd = computeFuelConsumption({
      tankLiters: 400, startPercent: 80, endPercent: null, litersAdded: 100, engineHoursDelta: 5,
    });
    expect(noEnd.consumedLiters).toBeNull();
    expect(noEnd.perEngineHour).toBeNull();
  });

  it('нулевой или отсутствующий прирост моточасов — без деления на ноль', () => {
    // Расход посчитать можно, а на моточас — нет: 220 / 0 взорвалось бы.
    const zero = computeFuelConsumption({
      tankLiters: 400, startPercent: 80, endPercent: 50, litersAdded: 100, engineHoursDelta: 0,
    });
    expect(zero.consumedLiters).toBe(220);
    expect(zero.perEngineHour).toBeNull();

    const missing = computeFuelConsumption({
      tankLiters: 400, startPercent: 80, endPercent: 50, litersAdded: 100, engineHoursDelta: null,
    });
    expect(missing.consumedLiters).toBe(220);
    expect(missing.perEngineHour).toBeNull();
  });

  it('округление объёма: литр — до целого, .5 вверх', () => {
    // 333 · (50 − 0) / 100 = 166.5 л → Math.round → 167.
    const r = computeFuelConsumption({
      tankLiters: 333, startPercent: 50, endPercent: 0, litersAdded: 0, engineHoursDelta: null,
    });
    expect(r.consumedLiters).toBe(167);
  });

  it('округление удельного расхода: один знак после запятой', () => {
    // 100 / 7 = 14.2857… → round(142.857) / 10 = 14.3 л/моточас.
    const r = computeFuelConsumption({
      tankLiters: 400, startPercent: 100, endPercent: 75, litersAdded: 0, engineHoursDelta: 7,
    });
    expect(r.consumedLiters).toBe(100);
    expect(r.perEngineHour).toBe(14.3);
  });
});