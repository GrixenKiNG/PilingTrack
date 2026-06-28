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

import { createMaintenance, updateMaintenance, acceptMaintenance } from '../equipment-maintenance';

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

  it('coerces null partsUsedText to empty string', async () => {
    await createMaintenance('eq_1', { type: 'REPAIR', title: 'x', partsUsedText: null }, { tenantId: 'orion' });
    const data = createRecMock.mock.calls[0][0].data;
    expect(data.partsUsedText).toBe('');
  });

  it('persists two-stage workDone, empty by default', async () => {
    await createMaintenance('eq_1', { type: 'REPAIR', title: 'x', workDone: 'заменили насос' }, { tenantId: 'orion' });
    expect(createRecMock.mock.calls[0][0].data.workDone).toBe('заменили насос');
    createRecMock.mockClear();
    await createMaintenance('eq_1', { type: 'REPAIR', title: 'x' }, { tenantId: 'orion' });
    expect(createRecMock.mock.calls[0][0].data.workDone).toBe('');
  });

  it('auto-stamps startedAt when created directly as IN_PROGRESS', async () => {
    await createMaintenance('eq_1', { type: 'REPAIR', title: 'x', status: 'IN_PROGRESS' }, { tenantId: 'orion' });
    const data = createRecMock.mock.calls[0][0].data;
    expect(data.startedAt).toBeInstanceOf(Date);
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

  it('does not overwrite startedAt when already started', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', equipmentId: 'eq_1', completedAt: null, startedAt: new Date('2026-01-01T00:00:00Z'), tenantId: 'orion' });
    await updateMaintenance('eq_1', 'rec_1', { status: 'IN_PROGRESS' }, { tenantId: 'orion', userId: 'usr_9' });
    const data = updateRecMock.mock.calls[0][0].data;
    expect(data.startedAt).toBeUndefined();
  });

  it('persists two-stage workDone on update', async () => {
    await updateMaintenance('eq_1', 'rec_1', { workDone: 'продули радиатор' }, { tenantId: 'orion', userId: 'usr_9' });
    expect(updateRecMock.mock.calls[0][0].data.workDone).toBe('продули радиатор');
  });

  it('rejects edits to an already-accepted record', async () => {
    findUniqueRecMock.mockResolvedValue({
      id: 'rec_1', equipmentId: 'eq_1', completedAt: new Date(), startedAt: new Date(), tenantId: 'orion',
      acceptedById: 'usr_admin',
    });
    await expect(
      updateMaintenance('eq_1', 'rec_1', { cost: 999 }, { tenantId: 'orion', userId: 'usr_9' }),
    ).rejects.toThrow('Запись уже принята');
    expect(updateRecMock).not.toHaveBeenCalled();
  });
});

describe('acceptMaintenance — приёмка', () => {
  beforeEach(() => {
    findUniqueRecMock.mockReset();
    updateRecMock.mockReset();
    updateRecMock.mockResolvedValue({ id: 'rec_1' });
  });

  it('stamps acceptedBy/acceptedAt and closes the record', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', tenantId: 'orion', acceptedById: null, completedAt: null });
    await acceptMaintenance('rec_1', { tenantId: 'orion', userId: 'admin_1' });
    const data = updateRecMock.mock.calls[0][0].data;
    expect(data.acceptedById).toBe('admin_1');
    expect(data.acceptedAt).toBeInstanceOf(Date);
    expect(data.status).toBe('DONE');
    expect(data.completedAt).toBeInstanceOf(Date);
  });

  it('rejects cross-tenant record; writes nothing', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', tenantId: 'other', acceptedById: null, completedAt: null });
    await expect(acceptMaintenance('rec_1', { tenantId: 'orion', userId: 'admin_1' }))
      .rejects.toThrow('Maintenance record not found');
    expect(updateRecMock).not.toHaveBeenCalled();
  });

  it('rejects double-accept (409); writes nothing', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', tenantId: 'orion', acceptedById: 'admin_0', completedAt: new Date() });
    await expect(acceptMaintenance('rec_1', { tenantId: 'orion', userId: 'admin_1' }))
      .rejects.toThrow(/принят/i);
    expect(updateRecMock).not.toHaveBeenCalled();
  });
});
