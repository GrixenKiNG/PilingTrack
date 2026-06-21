/**
 * Regression: fleet analytics must scope the Equipment selection by tenant.
 *
 * The report CTE filtered by tenantId, but the outer `FROM "Equipment" e`
 * selection did not, so equipment identity + maintenance metadata of every
 * tenant leaked into an admin/dispatcher's analytics payload once a second
 * tenant existed. This test pins the tenant predicate onto the raw query.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryRaw, groupBy } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  groupBy: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    $queryRaw: queryRaw,
    telemetryRecord: { groupBy: groupBy },
  },
}));

import { getEquipmentAnalytics } from '../equipment-analytics-service';

describe('getEquipmentAnalytics — tenant isolation', () => {
  beforeEach(() => {
    queryRaw.mockReset();
    groupBy.mockReset();
    queryRaw.mockResolvedValue([]);
    groupBy.mockResolvedValue([]);
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
    groupBy.mockReset();
    queryRaw.mockResolvedValue([]);
    groupBy.mockResolvedValue([]);
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
