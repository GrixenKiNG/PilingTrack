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
    siteName: 'НПС-26',
    equipmentName: 'СП-49Д',
    hammerType: 'СП-75А',
    drivenAt: '2026-08-18T08:00:00.000Z',
    ...overrides,
  } as PilePassportRow;
}

const ctx = { header, organisation: 'ООО «ТрубопроводСтрой»', inn: '7700000000', timezone: 'Europe/Moscow' };
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

  it('шапка и даты берутся из принятых свай, форма названа по приказу', () => {
    const t = text(aookRows({ ...ctx, rows: [pile(), pile({ pileNumber: 'С-118', drivenAt: '2026-08-22T08:00:00.000Z' })] }));
    for (const part of ['ООО «ТрубопроводСтрой»', '7700000000', 'НПС-26', '18.08.2026', '22.08.2026', 'Приложение № 4']) {
      expect(t).toContain(part);
    }
  });

  it('пять блоков подписантов и четыре варианта решения', () => {
    const rows = aookRows({ ...ctx, rows: [pile()] });
    expect(rows.filter((row) => row[0] === '(фамилия, инициалы)')).toHaveLength(5);
    expect(text(rows)).toContain('разрешается полное нагружение');
  });
  describe('шапка акта считается по принятым сваям, а не по всей выборке', () => {
    // Агрегат по всем сваям периода — как его отдаёт pileJournalHeader в проде.
    const wholePeriod = {
      ...header,
      siteNames: ['НПС-26', 'Чужой объект'],
      equipmentNames: ['Banut 655', 'Bauer RTG RM20'],
      hammerTypes: ['PVE 50PR', 'PVE 7NL'],
      dateFrom: '28.08.2026',
      dateTo: '29.10.2026',
    } as PileJournalHeader;
    const accepted = pile({ equipmentName: 'Bauer RTG RM20', hammerType: 'PVE 7NL', drivenAt: '2026-10-29T08:00:00.000Z' });
    const other = pile({ pileNumber: 'С-200', acceptance: 'PENDING', equipmentName: 'Banut 655', hammerType: 'PVE 50PR', drivenAt: '2026-08-28T08:00:00.000Z' });

    it('даты и объект — только принятой сваи', () => {
      const t = text(aookRows({ ...ctx, header: wholePeriod, rows: [other, accepted] }));
      expect(t).toContain('29.10.2026');
      expect(t).toContain('НПС-26');
      for (const foreign of ['28.08.2026', 'Чужой объект']) expect(t).not.toContain(foreign);
    });

    it('даты — день по поясу организации, от самой ранней до самой поздней принятой', () => {
      const early = pile({ pileNumber: 'С-1', drivenAt: '2026-10-27T21:30:00.000Z' }); // 28.10 00:30 МСК
      const t = text(aookRows({ ...ctx, header: wholePeriod, rows: [accepted, early] }));
      expect(t).toContain('28.10.2026');
      expect(t).toContain('29.10.2026');
    });

    it('принятых нет — шапка из журнала, акт пустой с пометкой «не включено», без ошибки', () => {
      const t = text(aookRows({ ...ctx, header: wholePeriod, rows: [other] }));
      expect(t).toContain('не включено: 1');
      expect(t).toContain('28.08.2026');
      expect(t).toContain('Чужой объект');
    });
  });
});
