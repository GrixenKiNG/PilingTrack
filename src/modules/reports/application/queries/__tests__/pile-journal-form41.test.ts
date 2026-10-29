/**
 * Форма № 4.1 СП 392.1325800.2018 «Журнал погружения (забивки свай)».
 * Проверяем расчётные графы на числах из образца заказчика (свая С-117).
 */
import { describe, expect, it } from 'vitest';
import { form41Rows } from '../pile-journal-form41';
import type { PileJournalHeader, PilePassportRow } from '../pile-journal-types';

const header: PileJournalHeader = {
  siteNames: ['НПС-26'],
  equipmentNames: ['СП-49Д'],
  hammerTypes: ['СП-75А'],
  hammerEnergyKj: [60],
  designRefusalMm: [12],
  dateFrom: '18.08.2026',
  dateTo: '19.08.2026',
  pilesTotal: 2,
  draftPiles: 0,
  withoutPassportPiles: 0,
  accepted: 2,
  needsRedrive: 0,
  pending: 0,
  rowsTotal: 2,
};

function pile(overrides: Partial<PilePassportRow> = {}): PilePassportRow {
  return {
    id: 'p1',
    pileWorkId: 'w1',
    passportId: 'p1',
    hasPassport: true,
    isDraft: false,
    shiftAutoClosed: false,
    count: 1,
    pileNumber: 'С-117',
    drivenAt: '2026-08-18T08:00:00.000Z',
    siteName: 'НПС-26',
    shiftType: 'DAY',
    locationName: null,
    operatorName: 'Иванов',
    equipmentName: 'СП-49Д',
    recordedByForeman: false,
    pileGradeName: 'С120.35-10',
    pileSection: '350×350',
    pileLengthM: 12,
    designHeadLevelM: 102.4,
    actualHeadLevelM: 102.42,
    drivenDepthM: null,
    followerUsed: false,
    redriven: false,
    headCutOff: false,
    refusalSetPenetrationMm: null,
    refusalSetBlows: null,
    designRefusalMm: 12,
    refusalMm: 11,
    refusalSetsUsed: 3,
    joints: [],
    sets: [
      { ordinal: 1, blows: 10, penetrationMm: 180, dropHeightM: 2.1, refusalMm: 18 },
      { ordinal: 2, blows: 10, penetrationMm: 70, dropHeightM: 2.1, refusalMm: 7 },
      { ordinal: 3, blows: 10, penetrationMm: 110, dropHeightM: 2.1, refusalMm: 11 },
    ],
    drivingComplete: true,
    totalBlows: 30,
    blowsLastMeter: null,
    planDeviationMm: null,
    tiltPercent: null,
    hammerType: 'СП-75А',
    hammerEnergyKj: 60,
    dropHeightM: 2.1,
    note: null,
    acceptance: 'ACCEPTED',
    acceptanceNote: null,
    acceptedAt: null,
    acceptedByName: null,
    redriveReadyAt: null,
    suggestion: null,
    ...overrides,
  };
}

const ctx = { header, organisation: 'ООО «ТрубопроводСтрой»', truncated: false, timezone: 'Europe/Moscow' };

/** Строка данных сваи — первая после строки с номерами граф. */
function dataRows(rows: ReturnType<typeof form41Rows>) {
  const numbering = rows.findIndex((row) => row[0] === 1 && row[1] === 2);
  return rows.slice(numbering + 1).filter((row) => typeof row[1] === 'string' && /^С-/.test(String(row[1])));
}

describe('form41Rows — форма № 4.1 СП 392', () => {
  it('отметка острия = отметка головы минус длина (проект и факт)', () => {
    const [row] = dataRows(form41Rows({ ...ctx, rows: [pile()] }));
    expect(row.slice(7, 11)).toEqual([102.4, 102.42, 90.4, 90.42]);
  });

  it('глубина от залогов в сантиметрах и отказ последнего залога', () => {
    const [row] = dataRows(form41Rows({ ...ctx, rows: [pile()] }));
    expect(row[18]).toBe(36); // (180 + 70 + 110) мм
    expect(row[19]).toBe(1.1); // 11 мм/удар → 1,1 см
    expect(row[11]).toBe('1–3');
    expect(row[12]).toBe('10');
    expect(row[21]).toContain('проектный отказ достигнут');
  });

  it('графы, которых нет в данных, остаются пустыми, а не выдумываются', () => {
    const [row] = dataRows(form41Rows({ ...ctx, rows: [pile()] }));
    // вес сваи, частота, продолжительность, погружение от собственного веса и от бабы, вес ударной части
    for (const index of [6, 13, 14, 16, 17, 20]) expect(row[index]).toBe('');
  });

  it('свая без паспорта в форму не попадает, но об этом сказано', () => {
    const rows = form41Rows({
      ...ctx,
      rows: [pile(), pile({ id: 'x', hasPassport: false, passportId: null, pileNumber: null, sets: [] })],
    });
    expect(dataRows(rows)).toHaveLength(1);
    expect(JSON.stringify(rows)).toContain('без паспорта');
  });

  it('титул: организация, объект, копёр, молот, период; реквизиты для заполнения от руки', () => {
    const text = JSON.stringify(form41Rows({ ...ctx, rows: [pile()] }));
    expect(text).toContain('Форма № 4.1 СП 392.1325800.2018');
    expect(text).toContain('ООО «ТрубопроводСтрой»');
    expect(text).toContain('НПС-26');
    expect(text).toContain('СП-49Д');
    expect(text).toContain('18.08.2026');
    expect(text).toContain('________');
  });

  it('срез выгрузки не замалчивается', () => {
    const text = JSON.stringify(form41Rows({ ...ctx, truncated: true, rows: [pile()] }));
    expect(text).toContain('Показаны первые');
  });
});
