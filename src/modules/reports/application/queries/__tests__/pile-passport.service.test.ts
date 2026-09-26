/**
 * Дата забивки в журнале — календарный день тенанта, а не UTC (F-R17-1).
 *
 * `drivenAt` — момент времени: свая, забитая в 00:30 МСК 26.09, в UTC ещё
 * 25.09. Журнал забивки распечатывают и подшивают, поэтому день в нём обязан
 * совпадать с фактическим, а не отставать на сутки.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Sheet = { name: string; rows: (string | number | null)[][] };

const { pileFindMany, userFindMany, sheets } = vi.hoisted(() => ({
  pileFindMany: vi.fn(),
  userFindMany: vi.fn(),
  sheets: { current: [] as Sheet[] },
}));

vi.mock('@/lib/db', () => ({
  db: {
    pilePassport: { findMany: pileFindMany },
    user: { findMany: userFindMany },
  },
}));

vi.mock('@/modules/settings', () => ({
  getSettings: vi.fn(async () => ({ timezone: 'Europe/Moscow' })),
}));

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
  });

  it('дату забивки 25.09 21:30 UTC печатает как 26.09.2026 по Москве', async () => {
    await exportPileJournalXlsx({ tenantId: 'orion' });

    // Колонка «Дата забивки» — первая строка после шапки листа журнала.
    expect(sheet('Журнал забивки').rows[1][1]).toBe('26.09.2026');
    // Период в титуле — тем же днём тенанта и в печатном виде.
    expect(sheet('Титул').rows).toContainEqual(['Период забивки', '26.09.2026 — 26.09.2026']);
  });
});
