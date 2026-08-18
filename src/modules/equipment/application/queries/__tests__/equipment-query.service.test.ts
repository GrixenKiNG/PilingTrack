/**
 * listAllEquipment — operator scope regression test.
 *
 * Guards the ACL fix from 2026-04: operators must only see equipment they
 * are crew-assigned to (via an active crew). Without operatorUserId, all
 * equipment is returned (admin/dispatcher view).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findManyMock, findManyRecMock, findUniqueRecMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  findManyRecMock: vi.fn(),
  findUniqueRecMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    equipment: { findMany: findManyMock },
    maintenanceRecord: { findMany: findManyRecMock, findUnique: findUniqueRecMock },
  },
}));

import { listAllEquipment } from '../equipment-query.service';

describe('listAllEquipment — operator scope', () => {
  beforeEach(() => {
    findManyMock.mockReset();
    findManyMock.mockResolvedValue([]);
  });

  it('returns all equipment when no operatorUserId is passed', async () => {
    await listAllEquipment('orion');
    const args = findManyMock.mock.calls[0][0];
    expect(args.where).toEqual({ tenantId: 'orion' });
  });

  it('filters by active crew assignment when operatorUserId is provided', async () => {
    await listAllEquipment('orion', undefined, null, 'user_op_42');
    const args = findManyMock.mock.calls[0][0];
    expect(args.where).toEqual({
      tenantId: 'orion',
      crews: { some: { isActive: true, operatorId: 'user_op_42' } },
    });
  });

  it('narrows operator scope further when siteId is provided', async () => {
    await listAllEquipment('orion', undefined, 'site_1', 'user_op_42');
    const args = findManyMock.mock.calls[0][0];
    expect(args.where).toEqual({
      tenantId: 'orion',
      crews: {
        some: { isActive: true, operatorId: 'user_op_42', siteId: 'site_1' },
      },
    });
  });

  it('does NOT add operator filter when operatorUserId is null', async () => {
    // Regression guard: passing null (admin path) must not accidentally
    // produce a `crews.some` filter that would silently hide equipment.
    await listAllEquipment('orion', undefined, 'site_1', null);
    const args = findManyMock.mock.calls[0][0];
    expect(args.where).toEqual({ tenantId: 'orion' });
  });

  // Раньше тенант был необязательным и применялся через `if (tenantId)`:
  // при пустом значении условие исчезало, и в ответ уходила техника всех
  // организаций. Проверки ниже требуют отказа, а не общей выборки.
  describe('без тенанта запрос не выполняется', () => {
    it.each([
      ['не передан', undefined],
      ['null', null],
      ['пустая строка', ''],
      ['одни пробелы', '   '],
    ])('%s — отказ, а не список всех организаций', async (_label, tenantId) => {
      await expect(listAllEquipment(tenantId as string | null | undefined)).rejects.toThrow(
        'Контекст организации не определён',
      );
      expect(findManyMock).not.toHaveBeenCalled();
    });
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

  it('applies only tenantId when no filters given', async () => {
    findManyRecMock.mockResolvedValue([]);
    const { listAllMaintenance } = await import('../equipment-query.service');
    await listAllMaintenance('orion');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup/fixture above
    const arg = findManyRecMock.mock.calls.at(-1)![0];
    expect(arg.where).toEqual({ tenantId: 'orion' });
  });

  it('applies priority and assigneeId filters when given', async () => {
    findManyRecMock.mockResolvedValue([]);
    const { listAllMaintenance } = await import('../equipment-query.service');
    await listAllMaintenance('orion', { priority: 'HIGH', assigneeId: 'usr_3' });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup/fixture above
    const arg = findManyRecMock.mock.calls.at(-1)![0];
    expect(arg.where.priority).toBe('HIGH');
    expect(arg.where.assigneeId).toBe('usr_3');
  });
});

describe('getMaintenanceById', () => {
  it('returns the record when tenant matches', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', tenantId: 'orion', equipmentId: 'eq_1' });
    const { getMaintenanceById } = await import('../equipment-query.service');
    const rec = await getMaintenanceById('rec_1', 'orion');
    expect(rec.id).toBe('rec_1');
  });
  it('throws 404 for cross-tenant record', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', tenantId: 'other', equipmentId: 'eq_1' });
    const { getMaintenanceById } = await import('../equipment-query.service');
    await expect(getMaintenanceById('rec_1', 'orion')).rejects.toThrow('Maintenance record not found');
  });
  it('throws when tenantId empty (fail-closed)', async () => {
    const { getMaintenanceById } = await import('../equipment-query.service');
    await expect(getMaintenanceById('rec_1', '')).rejects.toThrow();
  });
  it('throws 404 when not found', async () => {
    findUniqueRecMock.mockResolvedValue(null);
    const { getMaintenanceById } = await import('../equipment-query.service');
    await expect(getMaintenanceById('missing', 'orion')).rejects.toThrow('Maintenance record not found');
  });
});
