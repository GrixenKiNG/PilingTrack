import { describe, it, expect } from 'vitest';
import { getConsumables } from '../consumables';

describe('getConsumables', () => {
  it('возвращает пусто для ЕО и неизвестных моделей', () => {
    expect(getConsumables('PVE 50PR', 'EO')).toEqual([]);
    expect(getConsumables('Нет такой', 'TO2')).toEqual([]);
    expect(getConsumables(null, 'TO1')).toEqual([]);
  });

  it('полный комплект: один и тот же список на любом уровне ТО', () => {
    const to1 = getConsumables('PVE 50PR', 'TO1');
    const to2 = getConsumables('PVE 50PR', 'TO2');
    const to3 = getConsumables('PVE 50PR', 'TO3');
    expect(to1.length).toBeGreaterThan(0);
    const names = (l: typeof to1) => l.map((c) => c.name).sort();
    expect(names(to1)).toEqual(names(to2));
    expect(names(to2)).toEqual(names(to3));
  });

  it('полный комплект PVE 50PR содержит двигатель, гидравлику и смазку', () => {
    const kit = getConsumables('PVE 50PR', 'TO1');
    expect(kit.some((c) => c.name.includes('Масло моторное'))).toBe(true);
    expect(kit.some((c) => c.name.includes('Воздушный фильтр'))).toBe(true);
    expect(kit.some((c) => c.name.includes('Масло гидравлическое'))).toBe(true);
    expect(kit.some((c) => c.name.includes('Фильтр гидравлики'))).toBe(true);
    expect(kit.some((c) => c.name.includes('Смазка'))).toBe(true);
  });

  it('без дублей по названию (КБУРГ: смазка не повторяется)', () => {
    const kit = getConsumables('КБУРГ-16', 'TO3');
    const names = kit.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('каждая позиция имеет название, маркировку и количество', () => {
    for (const c of getConsumables('SD-20', 'TO3')) {
      expect(c.name).toBeTruthy();
      expect(c.marking).toBeTruthy();
      expect(c.qty).toBeTruthy();
    }
  });

  it('КБУРГ-16: полный комплект содержит смазки, гидравлику и масла', () => {
    const kit = getConsumables('КБУРГ-16', 'TO1');
    expect(kit.some((c) => c.marking.includes('Литол-24'))).toBe(true);
    expect(kit.some((c) => c.name.includes('Рабочая жидкость'))).toBe(true);
    expect(kit.some((c) => c.name.includes('Фильтроэлементы'))).toBe(true);
    expect(kit.some((c) => c.name.includes('Керосин'))).toBe(true);
    // тот же полный список на ТО-3
    expect(getConsumables('КБУРГ-16', 'TO3').length).toBe(kit.length);
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

  // Regression guard for the Liebherr LRH 100 reference data: these part numbers
  // were transcribed from the LB 20 LRH~100 manual and are easy to break by an
  // accidental edit. Pin the exact catalogue numbers per ТО level.
  it('LRH 100: полный комплект содержит точные артикулы из руководства', () => {
    const kit = getConsumables('LRH 100', 'TO3');
    const markings = kit.map((c) => c.marking).join(' | ');

    // Engine oil filter (D 936 L A6) + the two interchangeable numbers.
    expect(markings).toContain('5601056');
    expect(markings).toContain('10490037');
    // Air filter (main + safety), fuel and hydraulic filters.
    expect(markings).toContain('10802649');
    expect(markings).toContain('LE7367182');
    expect(markings).toContain('LE7367045');
    expect(markings).toContain('7616098');
  });
});
