/**
 * Форма № 2.5 ВСН 012-88 (часть II) «Сводная ведомость забитых свай».
 * Колонки и шапка — по бланку заказчика (Сводная ведомость забитых свай.xlsx).
 */
import { describe, expect, it } from 'vitest';
import { svodRows } from '../pile-journal-svod';
import type { PileJournalHeader, PilePassportRow } from '../pile-journal-types';

const header = {
  siteNames: ['НПС-26'],
  dateFrom: '18.08.2026',
  dateTo: '19.08.2026',
} as PileJournalHeader;

function pile(overrides: Partial<PilePassportRow> = {}): PilePassportRow {
  return {
    hasPassport: true,
    isDraft: false,
    pileNumber: 'С-117',
    drivenAt: '2026-08-18T08:00:00.000Z',
    shiftType: 'DAY',
    pileGradeName: 'С120.35-10',
    drivenDepthM: 11.93,
    totalBlows: 30,
    refusalMm: 11,
    redriven: false,
    hammerType: 'СП-75А',
    note: null,
    ...overrides,
  } as PilePassportRow;
}

const ctx = { header, organisation: 'ООО «ТрубопроводСтрой»', truncated: false, timezone: 'Europe/Moscow' };
const body = (rows: ReturnType<typeof svodRows>) =>
  rows.filter((row) => typeof row[0] === 'number' && typeof row[1] === 'string' && /^С-/.test(row[1]));

describe('svodRows — форма № 2.5 ВСН 012-88', () => {
  it('строка сваи: глубина в см, отказ в см, при забивке', () => {
    const [row] = body(svodRows({ ...ctx, rows: [pile()] }));
    expect(row).toEqual([1, 'С-117', 'С120.35-10', '18.08.2026, дневная', '', 1193, 'СП-75А', 30, 1.1, '', '']);
  });

  it('отказ добивки попадает в свою колонку', () => {
    const [row] = body(svodRows({ ...ctx, rows: [pile({ redriven: true })] }));
    expect(row.slice(8, 10)).toEqual(['', 1.1]);
  });

  it('шапка: подрядчик, объект, диапазон номеров и период', () => {
    const text = JSON.stringify(svodRows({ ...ctx, rows: [pile(), pile({ pileNumber: 'С-118' })] }));
    expect(text).toContain('ВСН 012-88');
    expect(text).toContain('ООО «ТрубопроводСтрой»');
    expect(text).toContain('НПС-26');
    expect(text).toContain('С-117');
    expect(text).toContain('С-118');
    expect(text).toContain('18.08.2026');
  });

  it('без паспорта в ведомость не входит, срез объявлен', () => {
    const rows = svodRows({ ...ctx, truncated: true, rows: [pile(), pile({ hasPassport: false, pileNumber: null })] });
    expect(body(rows)).toHaveLength(1);
    const text = JSON.stringify(rows);
    expect(text).toContain('без паспорта');
    expect(text).toContain('Показаны первые');
  });
});
