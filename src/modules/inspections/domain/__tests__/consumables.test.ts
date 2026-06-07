import { describe, it, expect } from 'vitest';
import { getConsumables } from '../consumables';

describe('getConsumables', () => {
  it('возвращает пусто для ЕО и неизвестных моделей', () => {
    expect(getConsumables('PVE 50PR', 'EO')).toEqual([]);
    expect(getConsumables('Нет такой', 'TO2')).toEqual([]);
    expect(getConsumables(null, 'TO1')).toEqual([]);
  });

  it('накопительно: ТО-2 включает расходники ТО-1', () => {
    const to1 = getConsumables('PVE 50PR', 'TO1');
    const to2 = getConsumables('PVE 50PR', 'TO2');
    expect(to1.length).toBeGreaterThan(0);
    expect(to2.length).toBeGreaterThan(to1.length);
    // все позиции ТО-1 присутствуют в ТО-2
    for (const c of to1) expect(to2.some((x) => x.name === c.name)).toBe(true);
  });

  it('ТО-3 ⊇ ТО-2 ⊇ ТО-1 (монотонно растёт)', () => {
    const sizes = (['TO1', 'TO2', 'TO3'] as const).map((l) => getConsumables('PVE 50PR', l).length);
    expect(sizes[0]).toBeLessThanOrEqual(sizes[1]);
    expect(sizes[1]).toBeLessThanOrEqual(sizes[2]);
  });

  it('Liebherr: Сезонное накапливает все уровни ТО', () => {
    const seasonal = getConsumables('LRH 100', 'SEASONAL');
    const to3 = getConsumables('LRH 100', 'TO3');
    expect(seasonal.length).toBeGreaterThan(to3.length);
  });

  it('каждая позиция имеет название, маркировку и количество', () => {
    for (const c of getConsumables('SD-20', 'TO3')) {
      expect(c.name).toBeTruthy();
      expect(c.marking).toBeTruthy();
      expect(c.qty).toBeTruthy();
    }
  });
});
