/**
 * Regression: fleet snapshot must scope equipment by tenant.
 *
 * The equipment query once filtered only on `isActive` (and optional crew),
 * never on `tenantId`, so a dispatcher/admin would see every tenant's rigs
 * once a second tenant existed (latent cross-tenant leak). These tests pin
 * the tenant filter onto the equipment query.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { equipmentFindMany, reportFindMany, analyticsFindMany } = vi.hoisted(() => ({
  equipmentFindMany: vi.fn(),
  reportFindMany: vi.fn(),
  analyticsFindMany: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    equipment: { findMany: equipmentFindMany },
    report: { findMany: reportFindMany },
    reportAnalytics: { findMany: analyticsFindMany },
  },
}));

import { getFleetSnapshot } from '../fleet-monitoring.service';

describe('getFleetSnapshot — tenant isolation', () => {
  beforeEach(() => {
    equipmentFindMany.mockReset();
    reportFindMany.mockReset();
    analyticsFindMany.mockReset();
    // Empty equipment → early return; we only assert the query's where clause.
    equipmentFindMany.mockResolvedValue([]);
    reportFindMany.mockResolvedValue([]);
    analyticsFindMany.mockResolvedValue([]);
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

describe('getFleetSnapshot — inventory fields and operators on shift', () => {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });

  beforeEach(() => {
    equipmentFindMany.mockReset();
    reportFindMany.mockReset();
    analyticsFindMany.mockReset();
    analyticsFindMany.mockResolvedValue([]);
  });

  it('maps inventory fields onto the card and serializes the maintenance date', async () => {
    const due = new Date('2026-07-01T00:00:00.000Z');
    equipmentFindMany.mockResolvedValue([
      {
        id: 'eq-1', name: 'PVE 50PR', model: 'PVE', manufactureYear: 2019,
        kind: 'PILE_DRIVER', inventoryNumber: 'ИНВ-1001', serialNumber: '50PR-1142',
        engineHoursTotal: 8450, nextMaintenanceDate: due, nextMaintenanceAtHours: 9000,
        crews: [],
      },
    ]);
    reportFindMany.mockResolvedValue([]);

    const snap = await getFleetSnapshot({ tenantId: 'orion' });
    const card = snap.equipment[0];

    expect(card.kind).toBe('PILE_DRIVER');
    expect(card.inventoryNumber).toBe('ИНВ-1001');
    expect(card.serialNumber).toBe('50PR-1142');
    expect(card.engineHoursTotal).toBe(8450);
    expect(card.nextMaintenanceDate).toBe(due.toISOString());
    expect(card.nextMaintenanceAtHours).toBe(9000);
    // No reports → idle, no today totals.
    expect(card.status).toBe('idle');
    expect(card.todayTotals).toBeNull();
  });

  it('counts distinct operators with a report today', async () => {
    equipmentFindMany.mockResolvedValue([
      {
        id: 'eq-1', name: 'A', model: '', manufactureYear: null, kind: 'OTHER',
        inventoryNumber: null, serialNumber: null, engineHoursTotal: null,
        nextMaintenanceDate: null, nextMaintenanceAtHours: null, crews: [],
      },
    ]);
    reportFindMany.mockResolvedValue([
      { id: 'r1', reportId: 'R1', equipmentId: 'eq-1', crewId: 'c1', userId: 'u1', date: today, shiftType: 'DAY', updatedAt: new Date(), user: { name: 'Иванов' }, site: { name: 'Объект' } },
      { id: 'r2', reportId: 'R2', equipmentId: 'eq-1', crewId: 'c1', userId: 'u2', date: today, shiftType: 'NIGHT', updatedAt: new Date(), user: { name: 'Петров' }, site: { name: 'Объект' } },
      { id: 'r3', reportId: 'R3', equipmentId: 'eq-1', crewId: 'c1', userId: 'u1', date: today, shiftType: 'DAY', updatedAt: new Date(), user: { name: 'Иванов' }, site: { name: 'Объект' } },
    ]);

    const snap = await getFleetSnapshot({ tenantId: 'orion' });

    expect(snap.totals.operatorsOnShiftToday).toBe(2);
  });
});
