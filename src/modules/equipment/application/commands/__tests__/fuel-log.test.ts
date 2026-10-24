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

import { computeFuelConsumption, recordOperatorFuelInTx } from '../fuel-log';

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

  it('бак объёмом 0 л — тоже неизвестен, а не «расход = долив»', () => {
    const r = computeFuelConsumption({
      tankLiters: 0, startPercent: 80, endPercent: 50, litersAdded: 100, engineHoursDelta: 5,
    });
    expect(r.consumedLiters).toBeNull();
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
// Машинист на ЕО после работы снимает остаток по указателю ДО заправки, а потом
// доливает. Сводка топлива считает «остаток после долива своей записи», поэтому
// замер и долив пишутся двумя записями: замер, затем долив на миллисекунду позже.
describe('recordOperatorFuelInTx — топливо из ЕО машиниста', () => {
  const at = new Date('2026-10-24T16:00:00.000Z');
  const ctx = { tenantId: 'tenant-a', recordedById: 'operator-a', note: 'ЕО после работы' };
  const fakeTx = () => ({ fuelLog: { create: vi.fn().mockResolvedValue({ id: 'f1' }) } });

  it('замер и долив — две записи, долив строго после замера', async () => {
    const tx = fakeTx();
    const n = await recordOperatorFuelInTx(tx as never, 'eq-1', { tankPercent: 62, litersAdded: 120, at }, ctx);
    expect(n).toBe(2);
    const [reading, topUp] = tx.fuelLog.create.mock.calls.map((c) => c[0].data);
    expect(reading).toMatchObject({ tenantId: 'tenant-a', equipmentId: 'eq-1', tankPercent: 62, litersAdded: null, source: 'MANUAL', recordedById: 'operator-a' });
    expect(topUp).toMatchObject({ tankPercent: null, litersAdded: 120 });
    expect(topUp.recordedAt.getTime()).toBeGreaterThan(reading.recordedAt.getTime());
  });

  it('только замер — одна запись', async () => {
    const tx = fakeTx();
    expect(await recordOperatorFuelInTx(tx as never, 'eq-1', { tankPercent: 40, litersAdded: null, at }, ctx)).toBe(1);
    expect(tx.fuelLog.create.mock.calls[0][0].data).toMatchObject({ tankPercent: 40, litersAdded: null });
  });

  it('только долив — одна запись', async () => {
    const tx = fakeTx();
    expect(await recordOperatorFuelInTx(tx as never, 'eq-1', { tankPercent: null, litersAdded: 80, at }, ctx)).toBe(1);
    expect(tx.fuelLog.create.mock.calls[0][0].data).toMatchObject({ tankPercent: null, litersAdded: 80 });
  });

  it('ноль литров и пустой замер ничего не пишут', async () => {
    const tx = fakeTx();
    expect(await recordOperatorFuelInTx(tx as never, 'eq-1', { tankPercent: null, litersAdded: 0, at }, ctx)).toBe(0);
    expect(tx.fuelLog.create).not.toHaveBeenCalled();
  });

  it('долив больше предела записи отклоняется целиком — ничего не пишется', async () => {
    const tx = fakeTx();
    await expect(recordOperatorFuelInTx(tx as never, 'eq-1', { tankPercent: 50, litersAdded: 2001, at }, ctx))
      .rejects.toMatchObject({ status: 400 });
    expect(tx.fuelLog.create).not.toHaveBeenCalled();
  });

  it('остаток вне 0–100 % отклоняется, организация обязательна', async () => {
    const tx = fakeTx();
    await expect(recordOperatorFuelInTx(tx as never, 'eq-1', { tankPercent: 140, litersAdded: null, at }, ctx)).rejects.toMatchObject({ status: 400 });
    await expect(recordOperatorFuelInTx(tx as never, 'eq-1', { tankPercent: 50, litersAdded: null, at }, { ...ctx, tenantId: '' })).rejects.toMatchObject({ status: 400 });
    expect(tx.fuelLog.create).not.toHaveBeenCalled();
  });
});
