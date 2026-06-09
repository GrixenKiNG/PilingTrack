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

  it('КБУРГ-16: каждый уровень — полный список (не накопительно)', () => {
    const to1 = getConsumables('КБУРГ-16', 'TO1');
    const to2 = getConsumables('КБУРГ-16', 'TO2');
    const to3 = getConsumables('КБУРГ-16', 'TO3');
    // все уровни непустые и содержат смазку мачты
    for (const list of [to1, to2, to3]) {
      expect(list.length).toBeGreaterThan(0);
      expect(list.some((c) => c.marking.includes('Литол-24'))).toBe(true);
    }
    // ТО-2 — замена рабочей жидкости и фильтроэлементов ГС
    expect(to2.some((c) => c.name.includes('Рабочая жидкость'))).toBe(true);
    expect(to2.some((c) => c.name.includes('Фильтроэлементы'))).toBe(true);
    // не накопительно: ТО-3 НЕ содержит позицию ТО-1 «Керосин для промывки»
    expect(to3.some((c) => c.name.includes('Керосин'))).toBe(false);
  });

  it('учитывает расходники молота и вращателя', () => {
    const base = getConsumables('SD-20', 'TO1');
    const withDiesel = getConsumables('SD-20', 'TO1', { hammerKind: 'DIESEL' });
    expect(withDiesel.length).toBeGreaterThan(base.length);
    expect(withDiesel.some((c) => c.name.includes('Топливная смесь'))).toBe(true);

    const hyd1000 = getConsumables('PVE 50PR', 'TO3', { hammerKind: 'HYDRAULIC' });
    expect(hyd1000.some((c) => c.name.includes('Азот'))).toBe(true);
    expect(hyd1000.some((c) => c.name.includes('уплотнений цилиндра'))).toBe(true);

    const combined = getConsumables('КБУРГ-16', 'TO3', { hammerKind: 'DIESEL', isCombined: true });
    expect(combined.some((c) => c.note === 'вращатель')).toBe(true);
    expect(combined.some((c) => c.note === 'молот')).toBe(true);
  });
});
