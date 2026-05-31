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
});
