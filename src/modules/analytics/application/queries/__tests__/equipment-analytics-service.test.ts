/**
 * Regression: fleet analytics must scope the Equipment selection by tenant.
 *
 * The report CTE filtered by tenantId, but the outer `FROM "Equipment" e`
 * selection did not, so equipment identity + maintenance metadata of every
 * tenant leaked into an admin/dispatcher's analytics payload once a second
 * tenant existed. This test pins the tenant predicate onto the raw query.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryRaw, telemetryFindMany, manualFindMany } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  telemetryFindMany: vi.fn(),
  manualFindMany: vi.fn(async () => []),
}));

vi.mock('@/lib/db', () => ({
  db: {
    $queryRaw: queryRaw,
    telemetryRecord: { findMany: telemetryFindMany },
    fuelLog: { findMany: manualFindMany },
  },
}));

import { getEquipmentAnalytics } from '../equipment-analytics-service';

function counterSamples(equipmentId: string, values: number[]) {
  return values.map((value, index) => ({ equipmentId, value, timestamp: new Date(Date.UTC(2026, 0, 1, index)) }));
}

describe('getEquipmentAnalytics — tenant isolation', () => {
  beforeEach(() => {
    queryRaw.mockReset();
    queryRaw.mockResolvedValue([]);
    telemetryFindMany.mockReset();
    queryRaw.mockResolvedValue([]);
    telemetryFindMany.mockResolvedValue([]);
  });

  it('uses production-day boundaries for the fuel window, including the next midnight exclusively', async () => {
    await getEquipmentAnalytics({ dateFrom: '2026-09-20', dateTo: '2026-09-26', tenantId: 'orion' });
    expect(telemetryFindMany.mock.calls[0][0].where.timestamp).toEqual({
      gte: new Date('2026-09-19T21:00:00Z'),
      lt: new Date('2026-09-26T21:00:00Z'),
    });
  });

  it('uses the configured timezone instead of the default for fuel boundaries', async () => {
    await getEquipmentAnalytics({
      dateFrom: '2026-09-20', dateTo: '2026-09-26', tenantId: 'orion', timezone: 'Asia/Tokyo',
    });
    expect(telemetryFindMany.mock.calls[0][0].where.timestamp).toEqual({
      gte: new Date('2026-09-19T15:00:00Z'),
      lt: new Date('2026-09-26T15:00:00Z'),
    });
  });

  it('binds tenantId into the Equipment query', async () => {
    await getEquipmentAnalytics({ dateFrom: '2026-01-01', dateTo: '2026-12-31', tenantId: 'orion' });

    // First $queryRaw call is the per-equipment aggregate query.
    const [strings, ...values] = queryRaw.mock.calls[0];
    const sql = (strings as string[]).join('?');

    // The Equipment selection itself must carry a tenant predicate, not just
    // the report CTE.
    expect(sql).toContain('e."tenantId"');
    // And the tenant value must actually be bound as a parameter.
    expect(values).toContain('orion');
  });

  // Fail-closed: a missing tenantId must throw, never run an unscoped query.
  // The codebase policy (resource-access-service.ts) is that multi-tenant
  // installs fail closed on a missing tenantId. A nullable tenant filter
  // (`IS NULL OR ...`) would instead return EVERY tenant's equipment — a
  // cross-tenant leak flagged by security review on 2026-05-31.
  it('throws when tenantId is missing instead of running an unscoped query', async () => {
    await expect(
      getEquipmentAnalytics({ dateFrom: '2026-01-01', dateTo: '2026-12-31', tenantId: null }),
    ).rejects.toThrow(/tenantId/i);

    expect(queryRaw).not.toHaveBeenCalled();
  });

  // Расход топлива берётся из TelemetryRecord — тенантной таблицы. Без
  // фильтра агрегат читал счётчики всех организаций и при совпадении
  // equipmentId вернул бы чужой расход.
  it('filters the telemetry fuel aggregate by tenant, keeping siteId optional', async () => {
    await getEquipmentAnalytics({ dateFrom: '2026-01-01', dateTo: '2026-12-31', siteId: 'site_A', tenantId: 'orion' });

    expect(telemetryFindMany.mock.calls[0][0].where).toMatchObject({
      tenantId: 'orion',
      siteId: 'site_A',
      type: 'fuel_total',
    });

    telemetryFindMany.mockClear();
    await getEquipmentAnalytics({ dateFrom: '2026-01-01', dateTo: '2026-12-31', tenantId: 'orion' });

    const where = telemetryFindMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ tenantId: 'orion' });
    expect(where).not.toHaveProperty('siteId');
  });
});

/**
 * Regression (F-TO-DUE / W-10): the fleet analytics screen used its own
 * ≤14-day / ≤50h rule that collapsed "overdue" into "soon", so the same rig
 * read "ТО скоро" here while every other screen (checkMaintenanceDue) showed
 * "Просрочено". The service must now delegate to the shared helper and expose
 * overdue and soon separately (maintenanceDue stays as their union for the
 * counter).
 */
describe('getEquipmentAnalytics — maintenance flags delegate to checkMaintenanceDue', () => {
  const DAY_MS = 86_400_000;

  function equipmentRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      equipmentId: 'e1',
      name: 'Kopernik',
      model: null,
      kind: 'rig',
      reportCount: 0,
      activeDays: 0,
      piles: 0,
      pileMeters: 0,
      drillingCount: 0,
      drillingMeters: 0,
      downtimeHours: 0,
      engineHoursTotal: null,
      nextMaintenanceAtHours: null,
      nextMaintenanceDate: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    queryRaw.mockReset();
    queryRaw.mockResolvedValue([]);
    telemetryFindMany.mockReset();
    telemetryFindMany.mockResolvedValue([]);
  });

  it('marks a past service date as overdue, not soon', async () => {
    const past = new Date(Date.now() - 5 * DAY_MS);
    queryRaw
      .mockResolvedValueOnce([equipmentRow({ nextMaintenanceDate: past })])
      .mockResolvedValueOnce([]);

    const res = await getEquipmentAnalytics({ dateFrom: '2026-01-01', dateTo: '2026-12-31', tenantId: 'orion' });

    expect(res.equipment[0].maintenanceOverdue).toBe(true);
    expect(res.equipment[0].maintenanceSoon).toBe(false);
    expect(res.equipment[0].maintenanceDue).toBe(true);
    expect(res.fleet.maintenanceDueCount).toBe(1);
  });

  it('sums raw fleet values before rounding and includes fuel only for selected equipment (AU124)', async () => {
    const rows = Array.from({ length: 40 }, (_, index) => equipmentRow({
      equipmentId: `e${index}`, pileMeters: 12.05, drillingMeters: 12.05, downtimeHours: 0.05,
    }));
    queryRaw.mockResolvedValueOnce(rows).mockResolvedValueOnce([]);
    telemetryFindMany.mockResolvedValue([
      ...rows.flatMap((row) => counterSamples(row.equipmentId, [0, 0.05])),
      ...counterSamples('outside-fleet', [0, 100]),
    ]);

    const result = await getEquipmentAnalytics({ dateFrom: '2026-01-01', dateTo: '2026-12-31', tenantId: 'orion' });

    expect(result.equipment[0]).toMatchObject({ pileMeters: 12.1, drillingMeters: 12.1, downtimeHours: 0.1, fuelLiters: 0.1 });
    expect(result.fleet).toMatchObject({ pileMeters: 482, drillingMeters: 482, downtimeHours: 2, fuelLiters: 2 });
  });

  it.each([0, 1, 2])('distinguishes unknown fuel from measured zero (%i samples)', async (count) => {
    queryRaw.mockResolvedValueOnce([equipmentRow()]).mockResolvedValueOnce([]);
    telemetryFindMany.mockResolvedValue(counterSamples('e1', Array(count).fill(100)));

    const result = await getEquipmentAnalytics({ dateFrom: '2026-01-01', dateTo: '2026-01-31', tenantId: 'orion' });

    expect(result.equipment[0].fuelLiters).toBe(count >= 2 ? 0 : null);
    expect(result.fleet.fuelLiters).toBe(count >= 2 ? 0 : null);
  });

  it('does not present a partial fuel sum as the whole fleet consumption', async () => {
    queryRaw.mockResolvedValueOnce([equipmentRow(), equipmentRow({ equipmentId: 'e2' })]).mockResolvedValueOnce([]);
    telemetryFindMany.mockResolvedValue(counterSamples('e1', [100, 125]));

    const result = await getEquipmentAnalytics({ dateFrom: '2026-01-01', dateTo: '2026-01-31', tenantId: 'orion' });

    expect(result.equipment.map((row) => row.fuelLiters)).toEqual([25, null]);
    expect(result.fleet.fuelLiters).toBeNull();
  });

  it('marks a service date inside the soon window as soon, not overdue', async () => {
    // Проверяем общий порог checkMaintenanceDue (SOON_DAYS = 7), а не старую
    // 14-дневную эвристику этого экрана.
    const soon = new Date(Date.now() + 5 * DAY_MS);
    queryRaw
      .mockResolvedValueOnce([equipmentRow({ nextMaintenanceDate: soon })])
      .mockResolvedValueOnce([]);

    const res = await getEquipmentAnalytics({ dateFrom: '2026-01-01', dateTo: '2026-12-31', tenantId: 'orion' });

    expect(res.equipment[0].maintenanceOverdue).toBe(false);
    expect(res.equipment[0].maintenanceSoon).toBe(true);
    expect(res.equipment[0].maintenanceDue).toBe(true);
  });
});

/**
 * Regression: pile metres (м.п.) per rig must come from PileGrade.lengthMm —
 * the single source of truth (src/lib/pile-length.ts) — not from
 * SitePilePlan.metersPerUnit (a planning figure with known-unreliable values)
 * or a 3-digit regex on the grade name. Otherwise this screen's м.п. drifts
 * from the report/PDF/dashboard, which already compute via pileLengthMeters().
 */
describe('getEquipmentAnalytics — pile meters source', () => {
  beforeEach(() => {
    queryRaw.mockReset();
    queryRaw.mockResolvedValue([]);
    telemetryFindMany.mockReset();
    queryRaw.mockResolvedValue([]);
    telemetryFindMany.mockResolvedValue([]);
  });

  it('computes pile meters from PileGrade.lengthMm, not the site plan or the grade name', async () => {
    await getEquipmentAnalytics({ dateFrom: '2026-01-01', dateTo: '2026-12-31', tenantId: 'orion' });

    const [strings] = queryRaw.mock.calls[0];
    const sql = (strings as string[]).join('?');

    expect(sql).toContain('"lengthMm"');
    expect(sql).not.toContain('metersPerUnit');
    expect(sql).not.toContain('SitePilePlan');
  });
});

/**
 * F-ANALYTICS-TENANT-SQL (F-20): тенант проверяется строгим равенством в КАЖДОМ
 * сыром запросе сервиса (агрегат по установкам + парето простоев), а
 * отсутствующий tenantId падает ДО $queryRaw. `IS NULL OR` встречается только в
 * необязательном фильтре объекта и привязан к siteId, не к tenantId.
 */
describe('getEquipmentAnalytics — tenant isolation in every raw query (F-ANALYTICS-TENANT-SQL)', () => {
  beforeEach(() => {
    queryRaw.mockReset();
    queryRaw.mockResolvedValue([]);
    telemetryFindMany.mockReset();
    queryRaw.mockResolvedValue([]);
    telemetryFindMany.mockResolvedValue([]);
  });

  it('scopes both raw queries by strict tenant equality, never `tenantId … IS NULL`', async () => {
    await getEquipmentAnalytics({
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      tenantId: 'orion',
      siteId: 'site_A',
    });

    // 0 — агрегат по установкам, 1 — парето простоев.
    expect(queryRaw).toHaveBeenCalledTimes(2);

    for (const [strings, ...values] of queryRaw.mock.calls) {
      const sql = (strings as string[]).join('?');

      expect(sql).toContain('r."tenantId" = ?');
      expect(sql).not.toMatch(/tenantId"?\s*(::text\s*)?IS NULL/i);
      expect(values).toContain('orion');

      // Единственное IS NULL OR — необязательный фильтр объекта.
      expect(sql.match(/IS NULL OR/g) ?? []).toHaveLength(1);
      expect(sql).toMatch(/\?::text IS NULL OR r\."siteId" = \?/);
    }

    // Внешняя выборка техники (не только CTE отчётов) тоже тенантная.
    const [outerStrings] = queryRaw.mock.calls[0];
    expect((outerStrings as string[]).join('?')).toContain('e."tenantId" = ?');
  });

  it('throws when tenantId is absent and never reaches $queryRaw or telemetry', async () => {
    await expect(
      getEquipmentAnalytics({ dateFrom: '2026-01-01', dateTo: '2026-12-31' }),
    ).rejects.toThrow(/tenantId/i);

    expect(queryRaw).not.toHaveBeenCalled();
    expect(telemetryFindMany).not.toHaveBeenCalled();
  });
});


describe('топливо — сброс счётчика', () => {
  it('1000→5 недостаточно для достоверного расхода', async () => {
    queryRaw.mockReset();
    queryRaw.mockResolvedValue([]);
    queryRaw.mockResolvedValueOnce([{ equipmentId: 'e1', name: 'Rig', model: null, kind: 'PILING_RIG', reportCount: 0, activeDays: 0, piles: 0, pileMeters: 0, drillingCount: 0, drillingMeters: 0, downtimeHours: 0, engineHoursTotal: null, nextMaintenanceAtHours: null, nextMaintenanceDate: null }]).mockResolvedValueOnce([]);
    telemetryFindMany.mockResolvedValue(counterSamples('e1', [1000, 5]));
    const result = await getEquipmentAnalytics({ dateFrom: '2026-01-01', dateTo: '2026-01-31', tenantId: 'orion' });
    expect(result.equipment[0].fuelLiters).toBeNull();
  });
});
