/**
 * Акт освидетельствования ответственных конструкций «Свайный фундамент»
 * (приложение № 4 к приказу Минстроя 344/пр).
 */
import { describe, expect, it } from 'vitest';
import { aookRows } from '../pile-journal-aook';
import type { PileJournalHeader, PilePassportRow } from '../pile-journal-types';

const header = {
  siteNames: ['НПС-26'],
  dateFrom: '18.08.2026',
  dateTo: '22.08.2026',
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
const text = (rows: ReturnType<typeof aookRows>) => JSON.stringify(rows);

describe('aookRows — АООК «Свайный фундамент»', () => {
  it('предъявляется свайный фундамент из принятых свай, остальные объявлены', () => {
    const t = text(aookRows({
      ...ctx,
      rows: [pile(), pile({ pileNumber: 'С-118' }), pile({ pileNumber: 'С-119', acceptance: 'PENDING' })],
    }));
    expect(t).toContain('Свайный фундамент');
    expect(t).toContain('С120.35-10, 350×350, длина 12 м — 2 шт.');
    expect(t).toContain('не включено: 1');
  });

  it('пункт 3 ссылается на акты скрытых работ, номера — для заполнения от руки', () => {
    const t = text(aookRows({ ...ctx, rows: [pile()] }));
    expect(t).toContain('осмотр свай до погружения');
    expect(t).toContain('погружение свай');
    expect(t).toContain('________');
  });

  it('шапка и даты берутся из журнала, форма названа по приказу', () => {
    const t = text(aookRows({ ...ctx, rows: [pile()] }));
    for (const part of ['ООО «ТрубопроводСтрой»', '7700000000', 'НПС-26', '18.08.2026', '22.08.2026', 'Приложение № 4']) {
      expect(t).toContain(part);
    }
  });

  it('пять блоков подписантов и четыре варианта решения', () => {
    const rows = aookRows({ ...ctx, rows: [pile()] });
    expect(rows.filter((row) => row[0] === '(фамилия, инициалы)')).toHaveLength(5);
    expect(text(rows)).toContain('разрешается полное нагружение');
  });
});
