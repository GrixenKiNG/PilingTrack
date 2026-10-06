/**
 * Журнал забивки строится из записей выработки (PileWork), а не из одних
 * паспортов (W14): сваи, записанные «пачкой» (count > 1, без паспорта), обязаны
 * быть видны — иначе журнал теряет почти всю фактическую забивку. Паспорт
 * подключается к строке по `pileWorkId` только ради замеров и решения.
 *
 * Здесь же — печать дня забивки в поясе тенанта, а не UTC (F-R17-1).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Sheet = { name: string; rows: (string | number | null)[][] };

const { pileWorkFindMany, pileUpdateMany, userFindMany, getSettings, sheets } = vi.hoisted(() => ({
  pileWorkFindMany: vi.fn(),
  pileUpdateMany: vi.fn(),
  userFindMany: vi.fn(),
  getSettings: vi.fn(),
  sheets: { current: [] as Sheet[] },
}));

vi.mock('@/lib/db', () => ({
  db: {
    pileWork: { findMany: pileWorkFindMany },
    pilePassport: { updateMany: pileUpdateMany },
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

import { decidePilePassport, exportPileJournalXlsx, listPilePassports } from '../pile-passport.service';

/** Строка выработки: одна запись = одна строка журнала. */
function work(overrides: Record<string, unknown> = {}) {
  return {
    id: 'w1',
    count: 1,
    occurredAt: new Date('2026-09-25T21:30:00.000Z'),
    receivedAt: new Date('2026-09-25T21:30:00.000Z'),
    pileGrade: null,
    picket: null,
    report: {
      site: { name: 'Объект' },
      user: { name: 'Иванов' },
      equipment: { name: 'СО-1' },
      crew: null,
      shiftType: 'DAY',
      status: 'submitted',
    },
    passport: null,
    ...overrides,
  };
}

/** Паспорт: замеры и решение по свае. */
function passport(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    pileNumber: 'СВ-1',
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
    ...overrides,
  };
}

const sheet = (name: string): Sheet => {
  const found = sheets.current.find((item) => item.name === name);
  if (!found) throw new Error(`листа «${name}» нет в выгрузке`);
  return found;
};

function defaultMocks() {
  sheets.current = [];
  pileWorkFindMany.mockReset();
  pileWorkFindMany.mockResolvedValue([work()]);
  userFindMany.mockReset();
  userFindMany.mockResolvedValue([]);
  getSettings.mockReset();
  getSettings.mockResolvedValue({
    timezone: 'Europe/Moscow',
    companyName: 'ООО «ОРИОН-Строй»',
    inn: '7701234567',
  });
}

// ---------------------------------------------------------------- строки

describe('listPilePassports — строки из выработки (W14)', () => {
  beforeEach(defaultMocks);

  it('свая, записанная пачкой (count 2) без паспорта, есть в журнале', async () => {
    pileWorkFindMany.mockResolvedValue([work({ count: 2, passport: null })]);

    const { rows } = await listPilePassports({ tenantId: 'orion' });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      pileWorkId: 'w1',
      passportId: null,
      hasPassport: false,
      acceptance: null,
      count: 2,
    });
    expect(rows[0].sets).toEqual([]);
  });

  it('отрицательная запись (поправка) видна со знаком', async () => {
    pileWorkFindMany.mockResolvedValue([work({ count: -4 })]);

    const { rows } = await listPilePassports({ tenantId: 'orion' });

    expect(rows[0].count).toBe(-4);
  });

  it('свая с паспортом PENDING: замеры и решение на месте', async () => {
    pileWorkFindMany.mockResolvedValue([
      work({
        passport: passport({
          acceptance: 'PENDING',
          designRefusalMm: 20,
          sets: [
            { ordinal: 1, blows: 10, penetrationMm: 30, dropHeightM: null },
            { ordinal: 2, blows: 10, penetrationMm: 24, dropHeightM: null },
            { ordinal: 3, blows: 10, penetrationMm: 18, dropHeightM: null },
          ],
        }),
      }),
    ]);

    const { rows } = await listPilePassports({ tenantId: 'orion' });

    expect(rows[0]).toMatchObject({
      passportId: 'p1',
      hasPassport: true,
      pileNumber: 'СВ-1',
      acceptance: 'PENDING',
      count: 1,
    });
    expect(rows[0].sets).toHaveLength(3);
    expect(rows[0].refusalMm).not.toBeNull();
  });

  it('отчёт-черновик помечен как черновик', async () => {
    pileWorkFindMany.mockResolvedValue([work({ report: { ...work().report, status: 'draft' } })]);

    const { rows } = await listPilePassports({ tenantId: 'orion' });

    expect(rows[0].isDraft).toBe(true);
  });

  it('организация — строгим равенством: выборка только по своему тенанту', async () => {
    await listPilePassports({ tenantId: 'tenant-a' });

    const where = pileWorkFindMany.mock.calls[0][0].where as Record<string, unknown>;
    expect(where.tenantId).toBe('tenant-a');
  });

  it('фильтр по решению ищет только среди паспортов', async () => {
    await listPilePassports({ tenantId: 'orion', acceptance: 'PENDING' });

    const where = pileWorkFindMany.mock.calls[0][0].where as { passport?: { acceptance?: string } };
    expect(where.passport?.acceptance).toBe('PENDING');
  });
});

// ---------------------------------------------------------------- выгрузка

describe('exportPileJournalXlsx — день тенанта', () => {
  beforeEach(defaultMocks);

  it('дату забивки 25.09 21:30 UTC печатает как 26.09.2026 по Москве', async () => {
    await exportPileJournalXlsx({ tenantId: 'orion' });

    // Колонка «Дата забивки» — первая строка после шапки листа журнала.
    expect(sheet('Журнал забивки').rows[1][1]).toBe('26.09.2026');
    // Период в титуле — тем же днём тенанта и в печатном виде.
    expect(sheet('Титул').rows).toContainEqual(['Период забивки', '26.09.2026 — 26.09.2026']);
  });

  it('период «26.09» считает по Москве: 25.09 21:30 UTC — внутри, 26.09 21:30 UTC — уже нет', async () => {
    await exportPileJournalXlsx({ tenantId: 'orion', dateFrom: '2026-09-26', dateTo: '2026-09-26' });

    const where = pileWorkFindMany.mock.calls[0][0].where as { OR: { occurredAt: { gte: Date; lt: Date } }[] };
    // Полночь 26.09 и полуночь 27.09 по Москве (UTC+3) в UTC.
    expect(where.OR[0].occurredAt.gte.toISOString()).toBe('2026-09-25T21:00:00.000Z');
    expect(where.OR[0].occurredAt.lt.toISOString()).toBe('2026-09-26T21:00:00.000Z');

    const night = new Date('2026-09-25T21:30:00.000Z'); // 26.09 00:30 МСК
    const nextNight = new Date('2026-09-26T21:30:00.000Z'); // 27.09 00:30 МСК
    expect(night >= where.OR[0].occurredAt.gte && night < where.OR[0].occurredAt.lt).toBe(true);
    expect(nextNight < where.OR[0].occurredAt.lt).toBe(false);
  });

  it('дату выгрузки печатает в поясе тенанта, а не UTC (F-R37-1)', async () => {
    // Выгрузка 26.09 в 01:00 МСК = 25.09 22:00 UTC.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-25T22:00:00.000Z') });
    try {
      await exportPileJournalXlsx({ tenantId: 'orion' });
      expect(sheet('Титул').rows).toContainEqual(['Журнал выгружен', '26.09.2026 01:00']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('границы дня считает по текущему смещению пояса, а не по фиксированному', async () => {
    getSettings.mockResolvedValue({ timezone: 'America/New_York' });

    await exportPileJournalXlsx({ tenantId: 'orion', dateFrom: '2026-07-01', dateTo: '2026-07-01' });
    const summer = pileWorkFindMany.mock.calls[0][0].where as { OR: { occurredAt: { gte: Date } }[] };
    expect(summer.OR[0].occurredAt.gte.toISOString()).toBe('2026-07-01T04:00:00.000Z'); // EDT, UTC-4

    await exportPileJournalXlsx({ tenantId: 'orion', dateFrom: '2026-01-15', dateTo: '2026-01-15' });
    const winter = pileWorkFindMany.mock.calls[1][0].where as { OR: { occurredAt: { gte: Date } }[] };
    expect(winter.OR[0].occurredAt.gte.toISOString()).toBe('2026-01-15T05:00:00.000Z'); // EST, UTC-5
  });
});

describe('exportPileJournalXlsx — организация и подписи (F-R44-1)', () => {
  beforeEach(defaultMocks);

  it('печатает название организации и ИНН из настроек тенанта', async () => {
    await exportPileJournalXlsx({ tenantId: 'orion' });

    expect(sheet('Титул').rows[1]).toEqual(['Организация: ООО «ОРИОН-Строй», ИНН 7701234567']);
  });

  it('не печатает пустые части: без названия остаётся только ИНН', async () => {
    getSettings.mockResolvedValue({ timezone: 'Europe/Moscow', companyName: '', inn: '7701234567' });

    await exportPileJournalXlsx({ tenantId: 'orion' });

    expect(sheet('Титул').rows[1]).toEqual(['ИНН 7701234567']);
  });

  it('без организации и ИНН строки на титуле нет', async () => {
    getSettings.mockResolvedValue({ timezone: 'Europe/Moscow', companyName: '', inn: '' });

    await exportPileJournalXlsx({ tenantId: 'orion' });

    const title = sheet('Титул').rows;
    expect(title[1][0]).toBe('Объект');
    expect(title.some((row) => typeof row[0] === 'string' && row[0].startsWith('Организация'))).toBe(false);
    expect(title.some((row) => typeof row[0] === 'string' && row[0].startsWith('ИНН'))).toBe(false);
  });

  it('после таблицы печатает дату составления по поясу тенанта и подписи', async () => {
    // Составление 26.09 в 01:00 МСК = 25.09 22:00 UTC.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-25T22:00:00.000Z') });
    try {
      await exportPileJournalXlsx({ tenantId: 'orion' });

      const rows = sheet('Журнал забивки').rows;
      const dateIndex = rows.findIndex((row) => row[0] === 'Дата составления: 26.09.2026');
      // Дата и подписи — под таблицей, а не вместо неё.
      expect(dateIndex).toBeGreaterThan(1);
      expect(rows).toContainEqual(['Производитель работ ____________ / ФИО /']);
      expect(rows).toContainEqual(['Представитель технического надзора ____________ / ФИО /']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('exportPileJournalXlsx — графа «Смена» (F-R44-1)', () => {
  beforeEach(defaultMocks);

  it('печатает смену сваи из отчёта', async () => {
    pileWorkFindMany.mockResolvedValue([
      work({ report: { ...work().report, shiftType: 'NIGHT' }, passport: passport() }),
    ]);

    await exportPileJournalXlsx({ tenantId: 'orion' });

    const rows = sheet('Журнал забивки').rows;
    expect(rows[0][2]).toBe('Смена');
    expect(rows[1][2]).toBe('Ночная');
  });

  it('без смены ячейка пуста, а не выдана за дневную', async () => {
    pileWorkFindMany.mockResolvedValue([work({ report: { ...work().report, shiftType: null } })]);

    await exportPileJournalXlsx({ tenantId: 'orion' });

    expect(sheet('Журнал забивки').rows[1][2]).toBe('');
  });
});

describe('exportPileJournalXlsx — пометки строк (W14)', () => {
  beforeEach(defaultMocks);

  const col = (name: string): number => sheet('Журнал забивки').rows[0].indexOf(name);

  it('свая без паспорта подшита с пометкой «без паспорта»', async () => {
    pileWorkFindMany.mockResolvedValue([work({ count: 2, passport: null })]);

    await exportPileJournalXlsx({ tenantId: 'orion' });

    const row = sheet('Журнал забивки').rows[1];
    expect(row[col('Пометка')]).toBe('без паспорта');
    expect(row[col('Количество, шт')]).toBe(2);
  });

  it('строка черновика помечена «черновик»', async () => {
    pileWorkFindMany.mockResolvedValue([
      work({ report: { ...work().report, status: 'draft' }, passport: passport() }),
    ]);

    await exportPileJournalXlsx({ tenantId: 'orion' });

    expect(sheet('Журнал забивки').rows[1][col('Пометка')]).toBe('черновик');
  });
});

describe('D4: сервис требует основание добивки', () => {
  it.each([undefined, '', ' \t\n '])('отклоняет %j и не пишет решение', async (note) => {
    pileUpdateMany.mockClear();
    await expect(decidePilePassport({ tenantId: 'tenant-a', passportId: 'p1', actorId: 'u1', acceptance: 'NEEDS_REDRIVE', note })).rejects.toMatchObject({ status: 400, message: 'Укажите, почему свая идёт на добивку' });
    expect(pileUpdateMany).not.toHaveBeenCalled();
  });
  it('сохраняет обрезанное основание, а принятие допускает без основания', async () => {
    pileUpdateMany.mockResolvedValue({ count: 1 });
    await decidePilePassport({ tenantId: 'tenant-a', passportId: 'p1', actorId: 'u1', acceptance: 'NEEDS_REDRIVE', note: '  Достичь проектного отказа  ' });
    expect(pileUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ acceptanceNote: 'Достичь проектного отказа' }) }));
    await decidePilePassport({ tenantId: 'tenant-a', passportId: 'p1', actorId: 'u1', acceptance: 'ACCEPTED' });
    expect(pileUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ acceptance: 'ACCEPTED', acceptanceNote: null }) }));
  });
});
