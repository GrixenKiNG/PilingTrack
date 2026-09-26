/**
 * Дата забивки в журнале — календарный день тенанта, а не UTC (F-R17-1).
 *
 * `drivenAt` — момент времени: свая, забитая в 00:30 МСК 26.09, в UTC ещё
 * 25.09. Журнал забивки распечатывают и подшивают, поэтому день в нём обязан
 * совпадать с фактическим, а не отставать на сутки.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Sheet = { name: string; rows: (string | number | null)[][] };

const { pileFindMany, userFindMany, getSettings, sheets } = vi.hoisted(() => ({
  pileFindMany: vi.fn(),
  userFindMany: vi.fn(),
  getSettings: vi.fn(),
  sheets: { current: [] as Sheet[] },
}));

vi.mock('@/lib/db', () => ({
  db: {
    pilePassport: { findMany: pileFindMany },
    user: { findMany: userFindMany },
  },
}));

vi.mock('@/modules/settings', () => ({ getSettings }));

vi.mock('@/lib/xlsx-writer', () => ({
  buildXlsx: (built: Sheet[]) => {
    sheets.current = built;
    return Buffer.from('');
  },
}));

import { exportPileJournalXlsx } from '../pile-passport.service';

/** Паспорт, забитый 26.09 в 00:30 МСК (в UTC это ещё 25.09). */
const atMoscowMidnight = {
  id: 'p1',
  pileNumber: 'СВ-1',
  drivenAt: new Date('2026-09-25T21:30:00.000Z'),
  recordedByForeman: false,
  designHeadLevelM: null,
  actualHeadLevelM: null,
  drivenDepthM: null,
  followerUsed: false,
  redriven: false,
  headCutOff: false,
  refusalSetPenetrationMm: null,
  refusalSetBlows: null,
  designRefusalMm: null,
  totalBlows: null,
  blowsLastMeter: null,
  planDeviationMm: null,
  tiltPercent: null,
  hammerType: null,
  hammerEnergyKj: null,
  dropHeightM: null,
  note: null,
  acceptance: 'PENDING',
  acceptanceNote: null,
  acceptedAt: null,
  acceptedById: null,
  sets: [],
  pileWork: { pileGrade: null, picket: null, report: null },
};

const sheet = (name: string): Sheet => {
  const found = sheets.current.find((item) => item.name === name);
  if (!found) throw new Error(`листа «${name}» нет в выгрузке`);
  return found;
};

describe('exportPileJournalXlsx — день тенанта', () => {
  beforeEach(() => {
    sheets.current = [];
    pileFindMany.mockReset();
    pileFindMany.mockResolvedValue([atMoscowMidnight]);
    userFindMany.mockReset();
    userFindMany.mockResolvedValue([]);
    getSettings.mockReset();
    getSettings.mockResolvedValue({ timezone: 'Europe/Moscow' });
  });

  it('дату забивки 25.09 21:30 UTC печатает как 26.09.2026 по Москве', async () => {
    await exportPileJournalXlsx({ tenantId: 'orion' });

    // Колонка «Дата забивки» — первая строка после шапки листа журнала.
    expect(sheet('Журнал забивки').rows[1][1]).toBe('26.09.2026');
    // Период в титуле — тем же днём тенанта и в печатном виде.
    expect(sheet('Титул').rows).toContainEqual(['Период забивки', '26.09.2026 — 26.09.2026']);
  });

  it('период «26.09» считает по Москве: 25.09 21:30 UTC — внутри, 26.09 21:30 UTC — уже нет', async () => {
    await exportPileJournalXlsx({ tenantId: 'orion', dateFrom: '2026-09-26', dateTo: '2026-09-26' });

    const where = pileFindMany.mock.calls[0][0].where as { drivenAt: { gte: Date; lt: Date } };
    // Полночь 26.09 и полуночь 27.09 по Москве (UTC+3) в UTC.
    expect(where.drivenAt.gte.toISOString()).toBe('2026-09-25T21:00:00.000Z');
    expect(where.drivenAt.lt.toISOString()).toBe('2026-09-26T21:00:00.000Z');

    const night = new Date('2026-09-25T21:30:00.000Z'); // 26.09 00:30 МСК
    const nextNight = new Date('2026-09-26T21:30:00.000Z'); // 27.09 00:30 МСК
    expect(night >= where.drivenAt.gte && night < where.drivenAt.lt).toBe(true);
    expect(nextNight < where.drivenAt.lt).toBe(false);
  });

  it('границы дня считает по текущему смещению пояса, а не по фиксированному', async () => {
    getSettings.mockResolvedValue({ timezone: 'America/New_York' });

    await exportPileJournalXlsx({ tenantId: 'orion', dateFrom: '2026-07-01', dateTo: '2026-07-01' });
    const summer = pileFindMany.mock.calls[0][0].where as { drivenAt: { gte: Date; lt: Date } };
    expect(summer.drivenAt.gte.toISOString()).toBe('2026-07-01T04:00:00.000Z'); // EDT, UTC-4

    await exportPileJournalXlsx({ tenantId: 'orion', dateFrom: '2026-01-15', dateTo: '2026-01-15' });
    const winter = pileFindMany.mock.calls[1][0].where as { drivenAt: { gte: Date; lt: Date } };
    expect(winter.drivenAt.gte.toISOString()).toBe('2026-01-15T05:00:00.000Z'); // EST, UTC-5
  });
});
