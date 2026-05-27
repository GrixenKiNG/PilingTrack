/**
 * createEquipmentDocument — tenant-source regression test.
 *
 * Guards the 2026-05-27 fix: tenantId must come from the acting user (ctx),
 * NOT from equipment.tenantId — the Equipment model has no tenantId column,
 * so the old `select: { tenantId: true }` + `data.tenantId = equipment.tenantId`
 * would 500 on the first real document create.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUniqueMock, createMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  createMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    equipment: { findUnique: findUniqueMock },
    equipmentDocument: { create: createMock },
  },
}));

import { createEquipmentDocument } from '../equipment-document';

describe('createEquipmentDocument — tenant source', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    createMock.mockReset();
    findUniqueMock.mockResolvedValue({ id: 'eq_1' });
    createMock.mockResolvedValue({ id: 'doc_1' });
  });

  it('writes tenantId from ctx, not from the equipment row', async () => {
    await createEquipmentDocument('eq_1', { type: 'PASSPORT', title: 'Паспорт' }, { tenantId: 'orion' });

    // Must not read a non-existent Equipment.tenantId column.
    expect(findUniqueMock.mock.calls[0][0].select).toEqual({ id: true });

    const data = createMock.mock.calls[0][0].data;
    expect(data.tenantId).toBe('orion');
    expect(data.equipmentId).toBe('eq_1');
  });

  it('throws 404 when equipment is missing', async () => {
    findUniqueMock.mockResolvedValue(null);
    await expect(
      createEquipmentDocument('missing', { type: 'OTHER', title: 'x' }, { tenantId: 'orion' }),
    ).rejects.toThrow('Equipment not found');
  });
});
