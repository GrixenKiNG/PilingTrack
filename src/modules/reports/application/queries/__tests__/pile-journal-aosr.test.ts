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
    siteName: 'НПС-26',
    equipmentName: 'СП-49Д',
    hammerType: 'СП-75А',
    drivenAt: '2026-08-18T08:00:00.000Z',
    ...overrides,
  } as PilePassportRow;
}

const ctx = { header, organisation: 'ООО «ТрубопроводСтрой»', inn: '7700000000', timezone: 'Europe/Moscow' };
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

  it('шапка, период, молот и копёр берутся из принятых свай; остальное — для заполнения от руки', () => {
    const t = text(aosrRows({ ...ctx, rows: [pile(), pile({ pileNumber: 'С-118', drivenAt: '2026-08-19T08:00:00.000Z' })] }));
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

    it('установка, молот и даты — только принятой сваи', () => {
      const t = text(aosrRows({ ...ctx, header: wholePeriod, rows: [other, accepted] }));
      expect(t).toContain('Bauer RTG RM20');
      expect(t).toContain('PVE 7NL');
      expect(t).toContain('29.10.2026');
      for (const foreign of ['Banut 655', 'PVE 50PR', '28.08.2026', 'Чужой объект']) expect(t).not.toContain(foreign);
    });

    it('даты — день по поясу организации, от самой ранней до самой поздней принятой', () => {
      const early = pile({ pileNumber: 'С-1', drivenAt: '2026-10-27T21:30:00.000Z' }); // 28.10 00:30 МСК
      const t = text(aosrRows({ ...ctx, header: wholePeriod, rows: [accepted, early] }));
      expect(t).toContain('28.10.2026');
      expect(t).toContain('29.10.2026');
    });

    it('принятых нет — шапка из журнала, акт пустой с пометкой «не включено», без ошибки', () => {
      const t = text(aosrRows({ ...ctx, header: wholePeriod, rows: [other] }));
      expect(t).toContain('не включено: 1');
      expect(t).toContain('28.08.2026');
      expect(t).toContain('Banut 655');
    });
  });
});
