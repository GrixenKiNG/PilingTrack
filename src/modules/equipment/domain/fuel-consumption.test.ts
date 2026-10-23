import { describe, expect, it } from 'vitest';
import { resolveFuelConsumption, summarizeManualFuel } from './fuel-consumption';

const readings = (...values: number[]) => values.map((value, i) => ({ value, timestamp: new Date(Date.UTC(2026, 0, 1, i)) }));
describe('FuelConsumption — источник и качество', () => {
  it('нет данных — none/insufficient/null', () => {
    expect(resolveFuelConsumption([], null, false)).toEqual({ liters: null, source: 'none', quality: 'insufficient' });
  });
  it('одно показание — telemetry/insufficient/null', () => {
    expect(resolveFuelConsumption(readings(100), null, false)).toEqual({ liters: null, source: 'telemetry', quality: 'insufficient' });
  });
  it.each([[100, 125, 25], [100, 100, 0]])('два показания %s→%s дают измеренный %s', (a, b, liters) => {
    expect(resolveFuelConsumption(readings(a, b), null, false)).toEqual({ liters, source: 'telemetry', quality: 'measured' });
  });
  it('оба источника: выбирает телеметрию без суммирования', () => {
    expect(resolveFuelConsumption(readings(100, 125), 80, true)).toEqual({ liters: 25, source: 'telemetry', quality: 'measured' });
  });
  it('одна точка телеметрии: выбирает достоверный ручной журнал', () => {
    expect(resolveFuelConsumption(readings(100), 0, true)).toEqual({ liters: 0, source: 'manual', quality: 'measured' });
  });
  it('сброс 1000→5 не превращается в 995 л', () => {
    expect(resolveFuelConsumption(readings(1000, 5), null, false)).toEqual({ liters: null, source: 'telemetry', quality: 'insufficient' });
    expect(resolveFuelConsumption(readings(1000, 5), 30, true).liters).toBe(30);
  });
  it('сброс внутри периода не скрывается ростом конца', () => {
    expect(resolveFuelConsumption(readings(100, 5, 120), null, false).liters).toBeNull();
  });
  it('дубли одной точки и противоречивые значения одного времени недостаточны', () => {
    const [point] = readings(100);
    expect(resolveFuelConsumption([point, point], null, false).liters).toBeNull();
    expect(resolveFuelConsumption([point, { ...point, value: 120 }], null, false).liters).toBeNull();
  });
});

const manual = (hour: number, tankPercent: number | null, litersAdded: number | null = null) => ({ recordedAt: new Date(Date.UTC(2026, 0, 1, hour)), tankPercent, litersAdded });
describe('ручной период', () => {
  it('один замер не даёт измеренный ноль', () => {
    expect(summarizeManualFuel(200, [manual(1, 80)], null).liters).toBeNull();
  });
  it('два равных замера дают измеренный ноль', () => {
    expect(summarizeManualFuel(200, [manual(1, 80), manual(2, 80)], null).liters).toBe(0);
  });
  it('не включает долив первого замера, если нет остатка до периода', () => {
    expect(summarizeManualFuel(200, [manual(1, 80, 100), manual(2, 50, 20)], null).liters).toBe(80);
  });
  it('учитывает отдельный долив после базового замера с тем же временем', () => {
    expect(summarizeManualFuel(200, [manual(1, 80), manual(1, null, 20), manual(2, 50)], null).liters).toBe(80);
  });
  it('не учитывает долив после конечного замера с тем же временем', () => {
    expect(summarizeManualFuel(200, [manual(1, 80), manual(2, 50), manual(2, null, 20)], null).liters).toBe(60);
  });
  it('учитывает доливы от остатка до периода, но не сам начальный долив', () => {
    expect(summarizeManualFuel(200, [manual(1, null, 20), manual(2, 50)], manual(0, 80, 100)).liters).toBe(80);
  });
  it('нет бака, нет второго замера, отрицательный баланс — недостаточно', () => {
    expect(summarizeManualFuel(null, [manual(1, 80), manual(2, 50)], null).liters).toBeNull();
    expect(summarizeManualFuel(200, [manual(1, 50), manual(2, 80)], null).liters).toBeNull();
  });
});
