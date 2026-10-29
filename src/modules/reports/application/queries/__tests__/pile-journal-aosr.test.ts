/**
 * Акт освидетельствования скрытых работ на погружение свай
 * (приложение № 3 к приказу Минстроя 344/пр).
 */
import { describe, expect, it } from 'vitest';
import { aosrRows } from '../pile-journal-aosr';
import type { PileJournalHeader, PilePassportRow } from '../pile-journal-types';

const header = {
  siteNames: ['НПС-26'],
  equipmentNames: ['СП-49Д'],
  hammerTypes: ['СП-75А'],
  dateFrom: '18.08.2026',
  dateTo: '19.08.2026',
} as PileJournalHeader;

function pile(overrides: Partial<PilePassportRow> = {}): PilePassportRow {
  return {
    hasPassport: true,
    pileNumber: 'С-117',
    pileGradeName: 'С120.35-10',
    pileSection: '350×350',
    pileLengthM: 12,
    acceptance: 'ACCEPTED',
    ...overrides,
  } as PilePassportRow;
}

const ctx = { header, organisation: 'ООО «ТрубопроводСтрой»', inn: '7700000000' };
const text = (rows: ReturnType<typeof aosrRows>) => JSON.stringify(rows);

describe('aosrRows — АОСР на погружение свай', () => {
  it('в акт идут только принятые сваи, остальные объявлены отдельной строкой', () => {
    const rows = aosrRows({
      ...ctx,
      rows: [
        pile(),
        pile({ pileNumber: 'С-118' }),
        pile({ pileNumber: 'С-119', acceptance: 'PENDING' }),
        pile({ pileNumber: 'С-120', acceptance: 'NEEDS_REDRIVE' }),
        pile({ pileNumber: null, hasPassport: false, acceptance: null }),
      ],
    });
    expect(text(rows)).toContain('2 шт.');
    expect(text(rows)).toContain('С-117, С-118');
    expect(text(rows)).not.toContain('С-119');
    expect(text(rows)).toContain('не включено');
  });

  it('сваи одной марки и длины сводятся в одну строку', () => {
    const rows = aosrRows({ ...ctx, rows: [pile(), pile({ pileNumber: 'С-118' }), pile({ pileNumber: 'С-200', pileLengthM: 9 })] });
    expect(text(rows)).toContain('С120.35-10, 350×350, длина 12 м — 2 шт.');
    expect(text(rows)).toContain('длина 9 м — 1 шт.');
  });

  it('шапка, период, молот и копёр берутся из журнала; остальное — для заполнения от руки', () => {
    const t = text(aosrRows({ ...ctx, rows: [pile()] }));
    for (const part of ['ООО «ТрубопроводСтрой»', '7700000000', 'НПС-26', 'СП-75А', 'СП-49Д', '18.08.2026', '19.08.2026', '________']) {
      expect(t).toContain(part);
    }
    expect(t).toContain('приказ Минстроя России от 16.05.2023 № 344/пр');
  });

  it('пять блоков подписантов', () => {
    const rows = aosrRows({ ...ctx, rows: [pile()] });
    expect(rows.filter((row) => row[0] === '(фамилия, инициалы)')).toHaveLength(5);
  });

  it('длинный перечень номеров свай обрезается со ссылкой на журнал', () => {
    const many = Array.from({ length: 80 }, (_, i) => pile({ pileNumber: `С-${i + 1}` }));
    const t = text(aosrRows({ ...ctx, rows: many }));
    expect(t).toContain('и ещё 30');
    expect(t).toContain('полный перечень — в журнале');
  });
});
