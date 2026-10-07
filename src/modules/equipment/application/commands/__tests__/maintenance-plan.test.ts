import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUniqueMock, updateMock, createMock, findEquipmentMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  updateMock: vi.fn(),
  createMock: vi.fn(),
  findEquipmentMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    maintenancePlan: { findUnique: findUniqueMock, update: updateMock, create: createMock },
    equipment: { findUnique: findEquipmentMock },
  },
}));

import { updateMaintenancePlan } from '../maintenance-plan';

const ctx = { tenantId: 'orion' };

describe('updateMaintenancePlan: смена типа меры (W67, W62 находка 5)', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    updateMock.mockReset();
    updateMock.mockResolvedValue({ id: 'p1' });
  });

  it('«по моточасам» → «по календарю» очищает прежний intervalHours', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'p1', tenantId: 'orion', triggerType: 'HOURS', intervalHours: 250, intervalDays: null,
    });

    await updateMaintenancePlan('p1', { triggerType: 'CALENDAR', intervalDays: 90 }, ctx);

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: expect.objectContaining({ triggerType: 'CALENDAR', intervalDays: 90, intervalHours: null }),
    });
  });

  it('«по календарю» → «по моточасам» очищает прежний intervalDays', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'p1', tenantId: 'orion', triggerType: 'CALENDAR', intervalHours: null, intervalDays: 90,
    });

    await updateMaintenancePlan('p1', { triggerType: 'HOURS', intervalHours: 250 }, ctx);

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: expect.objectContaining({ triggerType: 'HOURS', intervalHours: 250, intervalDays: null }),
    });
  });

  it('без triggerType интервалы пишутся только присланные', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'p1', tenantId: 'orion', triggerType: 'HOURS', intervalHours: 250, intervalDays: null,
    });

    await updateMaintenancePlan('p1', { title: 'ТО-1 уточнён' }, ctx);

    const { data } = updateMock.mock.calls[0][0];
    expect(data).not.toHaveProperty('intervalHours');
    expect(data).not.toHaveProperty('intervalDays');
    expect(data.title).toBe('ТО-1 уточнён');
  });

  it('не трогает регламент другого тенанта (404)', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'p1', tenantId: 'other', triggerType: 'HOURS', intervalHours: 250, intervalDays: null,
    });

    await expect(updateMaintenancePlan('p1', { triggerType: 'CALENDAR', intervalDays: 90 }, ctx))
      .rejects.toMatchObject({ status: 404 });
    expect(updateMock).not.toHaveBeenCalled();
  });
});
