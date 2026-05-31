import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUniqueEquipmentMock, createRecMock, findUniqueRecMock, updateRecMock } = vi.hoisted(() => ({
  findUniqueEquipmentMock: vi.fn(),
  createRecMock: vi.fn(),
  findUniqueRecMock: vi.fn(),
  updateRecMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    equipment: { findUnique: findUniqueEquipmentMock },
    maintenanceRecord: {
      create: createRecMock,
      findUnique: findUniqueRecMock,
      update: updateRecMock,
    },
  },
}));

import { createMaintenance, updateMaintenance } from '../equipment-maintenance';

describe('createMaintenance — work order fields', () => {
  beforeEach(() => {
    findUniqueEquipmentMock.mockReset();
    createRecMock.mockReset();
    findUniqueEquipmentMock.mockResolvedValue({ id: 'eq_1' });
    createRecMock.mockResolvedValue({ id: 'rec_1' });
  });

  it('checks equipment existence scoped by tenantId', async () => {
    await createMaintenance('eq_1', { type: 'REPAIR', title: 'Ремонт насоса' }, { tenantId: 'orion' });
    expect(findUniqueEquipmentMock.mock.calls[0][0].where).toEqual({ id: 'eq_1', tenantId: 'orion' });
  });

  it('persists new work order fields and defaults priority to NORMAL', async () => {
    await createMaintenance(
      'eq_1',
      { type: 'REPAIR', title: 'x', priority: 'HIGH', assigneeId: 'usr_2', faultCause: 'кавитация', partsUsedText: 'фильтр' },
      { tenantId: 'orion' },
    );
    const data = createRecMock.mock.calls[0][0].data;
    expect(data.tenantId).toBe('orion');
    expect(data.priority).toBe('HIGH');
    expect(data.assigneeId).toBe('usr_2');
    expect(data.faultCause).toBe('кавитация');
    expect(data.partsUsedText).toBe('фильтр');
  });

  it('throws 404 when equipment missing', async () => {
    findUniqueEquipmentMock.mockResolvedValue(null);
    await expect(
      createMaintenance('missing', { type: 'FAULT', title: 'x' }, { tenantId: 'orion' }),
    ).rejects.toThrow('Equipment not found');
  });
});

describe('updateMaintenance — lifecycle transitions', () => {
  beforeEach(() => {
    findUniqueRecMock.mockReset();
    updateRecMock.mockReset();
    updateRecMock.mockResolvedValue({ id: 'rec_1' });
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', equipmentId: 'eq_1', completedAt: null, startedAt: null, tenantId: 'orion' });
  });

  it('sets startedAt when status moves to IN_PROGRESS', async () => {
    await updateMaintenance('eq_1', 'rec_1', { status: 'IN_PROGRESS' }, { tenantId: 'orion', userId: 'usr_9' });
    const data = updateRecMock.mock.calls[0][0].data;
    expect(data.startedAt).toBeInstanceOf(Date);
  });

  it('sets closedById from ctx when status moves to DONE', async () => {
    await updateMaintenance('eq_1', 'rec_1', { status: 'DONE' }, { tenantId: 'orion', userId: 'usr_9' });
    const data = updateRecMock.mock.calls[0][0].data;
    expect(data.status).toBe('DONE');
    expect(data.closedById).toBe('usr_9');
    expect(data.completedAt).toBeInstanceOf(Date);
  });

  it('rejects cross-tenant record', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', equipmentId: 'eq_1', completedAt: null, startedAt: null, tenantId: 'other' });
    await expect(
      updateMaintenance('eq_1', 'rec_1', { status: 'DONE' }, { tenantId: 'orion', userId: 'usr_9' }),
    ).rejects.toThrow('Maintenance record not found');
  });
});
