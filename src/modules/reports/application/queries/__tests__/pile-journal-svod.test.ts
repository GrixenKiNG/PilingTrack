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
    count: 1,
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
  it('считает исключённые сваи в пачке, а не строки выработки', () => {
    const rows = svodRows({ ...ctx, rows: [pile({hasPassport: false, count: 5})] });
    expect(JSON.stringify(rows)).toContain('в ведомость не включено: 5');
  });

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
  describe('порядок строк: от первой забитой сваи к последней', () => {
    const newestFirst = [
      pile({ pileNumber: 'С-120', drivenAt: '2026-08-20T08:00:00.000Z' }),
      pile({ pileNumber: 'С-119', drivenAt: '2026-08-18T09:00:00.000Z' }),
      pile({ pileNumber: 'С-118', drivenAt: '2026-08-18T08:00:00.000Z' }),
    ];

    it('строки идут от самой ранней забивки к поздней, № п/п сквозной', () => {
      const rows = body(svodRows({ ...ctx, rows: newestFirst }));
      expect(rows.map((row) => [row[0], row[1]])).toEqual([[1, 'С-118'], [2, 'С-119'], [3, 'С-120']]);
    });

    it('«с № … по №» — первая и последняя свая в этом порядке', () => {
      const head = svodRows({ ...ctx, rows: newestFirst }).find((row) => row[0] === '(с №');
      expect(head).toEqual(['(с №', 'С-118', 'по №', 'С-120', ')']);
    });

    it('при равных датах — по номеру сваи', () => {
      const sameDay = [
        pile({ pileNumber: 'С-10', drivenAt: '2026-08-18T07:00:00.000Z' }),
        pile({ pileNumber: 'С-9', drivenAt: '2026-08-18T15:00:00.000Z' }),
      ];
      expect(body(svodRows({ ...ctx, rows: sameDay })).map((row) => row[1])).toEqual(['С-9', 'С-10']);
    });
  });

  describe('«Производитель работ» — мастер, принявший сваи', () => {
    const producer = (rows: ReturnType<typeof svodRows>) => rows.find((row) => row[0] === 'Производитель работ');
    const accepted = (acceptedByName: string | null, acceptedAt: string | null, overrides: Partial<PilePassportRow> = {}) =>
      pile({ acceptance: 'ACCEPTED', acceptedByName, acceptedAt, ...overrides });

    it('один мастер — его ФИО', () => {
      const row = producer(svodRows({ ...ctx, rows: [accepted('Петрова Д.В.', '2026-08-19T08:00:00.000Z')] }));
      expect(row?.[1]).toBe('Петрова Д.В.');
    });

    it('несколько — через запятую, без повторов, в порядке первого принятия', () => {
      const row = producer(svodRows({
        ...ctx,
        rows: [
          accepted('Сидоров К.Н.', '2026-08-20T08:00:00.000Z', { pileNumber: 'С-3' }),
          accepted('Петрова Д.В.', '2026-08-19T08:00:00.000Z', { pileNumber: 'С-2' }),
          accepted('Сидоров К.Н.', '2026-08-19T09:00:00.000Z', { pileNumber: 'С-1' }),
        ],
      }));
      expect(row?.[1]).toBe('Петрова Д.В., Сидоров К.Н.');
    });

    it('принявших нет — бланк, как раньше', () => {
      const row = producer(svodRows({ ...ctx, rows: [pile({ acceptance: 'PENDING' }), pile({ acceptance: 'NEEDS_REDRIVE', acceptedByName: 'Петрова Д.В.' })] }));
      expect(row?.[1]).toBe('________');
    });

    it('принятая, но без имени (мастера удалили) — бланк, не «null»', () => {
      const row = producer(svodRows({ ...ctx, rows: [accepted(null, '2026-08-19T08:00:00.000Z')] }));
      expect(row?.[1]).toBe('________');
    });
  });
});
