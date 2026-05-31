/**
 * Regression: fleet snapshot must scope equipment by tenant.
 *
 * The equipment query once filtered only on `isActive` (and optional crew),
 * never on `tenantId`, so a dispatcher/admin would see every tenant's rigs
 * once a second tenant existed (latent cross-tenant leak). These tests pin
 * the tenant filter onto the equipment query.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { equipmentFindMany, reportFindMany } = vi.hoisted(() => ({
  equipmentFindMany: vi.fn(),
  reportFindMany: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    equipment: { findMany: equipmentFindMany },
    report: { findMany: reportFindMany },
  },
}));

import { getFleetSnapshot } from '../fleet-monitoring.service';

describe('getFleetSnapshot — tenant isolation', () => {
  beforeEach(() => {
    equipmentFindMany.mockReset();
    reportFindMany.mockReset();
    // Empty equipment → early return; we only assert the query's where clause.
    equipmentFindMany.mockResolvedValue([]);
    reportFindMany.mockResolvedValue([]);
  });

  it('filters equipment by tenantId', async () => {
    await getFleetSnapshot({ tenantId: 'orion' });

    expect(equipmentFindMany).toHaveBeenCalledTimes(1);
    const where = equipmentFindMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe('orion');
  });

  it('keeps operator crew scoping alongside the tenant filter', async () => {
    await getFleetSnapshot({ tenantId: 'orion', operatorUserId: 'op-1' });

    const where = equipmentFindMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe('orion');
    expect(where.crews).toBeDefined();
  });

  // Defence-in-depth, symmetric with getEquipmentAnalytics: the type says
  // tenantId is a non-empty string and the route fails closed, but a falsy
  // tenant ('') would make Prisma match nothing and silently return an empty
  // fleet. Fail loud at the boundary instead.
  it('throws on an empty tenantId instead of querying', async () => {
    await expect(getFleetSnapshot({ tenantId: '' })).rejects.toThrow(/tenantId/i);

    expect(equipmentFindMany).not.toHaveBeenCalled();
  });
});
