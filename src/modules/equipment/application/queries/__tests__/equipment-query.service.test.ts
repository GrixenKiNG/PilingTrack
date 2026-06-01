/**
 * listAllEquipment — operator scope regression test.
 *
 * Guards the ACL fix from 2026-04: operators must only see equipment they
 * are crew-assigned to (via an active crew). Without operatorUserId, all
 * equipment is returned (admin/dispatcher view).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findManyMock, findManyRecMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  findManyRecMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    equipment: { findMany: findManyMock },
    maintenanceRecord: { findMany: findManyRecMock },
  },
}));

import { listAllEquipment } from '../equipment-query.service';

describe('listAllEquipment — operator scope', () => {
  beforeEach(() => {
    findManyMock.mockReset();
    findManyMock.mockResolvedValue([]);
  });

  it('returns all equipment when no operatorUserId is passed', async () => {
    await listAllEquipment();
    const args = findManyMock.mock.calls[0][0];
    expect(args.where).toEqual({});
  });

  it('filters by active crew assignment when operatorUserId is provided', async () => {
    await listAllEquipment(undefined, null, 'user_op_42');
    const args = findManyMock.mock.calls[0][0];
    expect(args.where).toEqual({
      crews: { some: { isActive: true, operatorId: 'user_op_42' } },
    });
  });

  it('narrows operator scope further when siteId is provided', async () => {
    await listAllEquipment(undefined, 'site_1', 'user_op_42');
    const args = findManyMock.mock.calls[0][0];
    expect(args.where).toEqual({
      crews: {
        some: { isActive: true, operatorId: 'user_op_42', siteId: 'site_1' },
      },
    });
  });

  it('does NOT add operator filter when operatorUserId is null', async () => {
    // Regression guard: passing null (admin path) must not accidentally
    // produce a `crews.some` filter that would silently hide equipment.
    await listAllEquipment(undefined, 'site_1', null);
    const args = findManyMock.mock.calls[0][0];
    expect(args.where).toEqual({});
  });
});

describe('listAllMaintenance', () => {
  it('scopes by tenantId and applies status filter', async () => {
    findManyRecMock.mockResolvedValue([{ id: 'rec_1' }]);
    const { listAllMaintenance } = await import('../equipment-query.service');
    await listAllMaintenance('orion', { status: 'PLANNED' });

    const arg = findManyRecMock.mock.calls[0][0];
    expect(arg.where.tenantId).toBe('orion');
    expect(arg.where.status).toBe('PLANNED');
  });

  it('throws when tenantId is empty (fail-closed)', async () => {
    const { listAllMaintenance } = await import('../equipment-query.service');
    await expect(listAllMaintenance('', {})).rejects.toThrow();
  });
});
