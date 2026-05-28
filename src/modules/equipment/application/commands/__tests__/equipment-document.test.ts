/**
 * createEquipmentDocument — tenant-source + tenant-isolation regression tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUniqueEquipmentMock, createDocMock, findUniqueDocMock, updateDocMock, deleteDocMock } = vi.hoisted(() => ({
  findUniqueEquipmentMock: vi.fn(),
  createDocMock: vi.fn(),
  findUniqueDocMock: vi.fn(),
  updateDocMock: vi.fn(),
  deleteDocMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    equipment: { findUnique: findUniqueEquipmentMock },
    equipmentDocument: {
      create: createDocMock,
      findUnique: findUniqueDocMock,
      update: updateDocMock,
      delete: deleteDocMock,
    },
  },
}));

import { createEquipmentDocument, updateEquipmentDocument, deleteEquipmentDocument } from '../equipment-document';

describe('createEquipmentDocument', () => {
  beforeEach(() => {
    findUniqueEquipmentMock.mockReset();
    createDocMock.mockReset();
    findUniqueEquipmentMock.mockResolvedValue({ id: 'eq_1' });
    createDocMock.mockResolvedValue({ id: 'doc_1' });
  });

  it('writes tenantId from ctx, not from the equipment row', async () => {
    await createEquipmentDocument('eq_1', { type: 'PASSPORT', title: 'Паспорт' }, { tenantId: 'orion' });

    // Existence check must include tenantId to prevent cross-tenant attach.
    expect(findUniqueEquipmentMock.mock.calls[0][0].where).toEqual({ id: 'eq_1', tenantId: 'orion' });

    const data = createDocMock.mock.calls[0][0].data;
    expect(data.tenantId).toBe('orion');
    expect(data.equipmentId).toBe('eq_1');
  });

  it('throws 404 when equipment is missing', async () => {
    findUniqueEquipmentMock.mockResolvedValue(null);
    await expect(
      createEquipmentDocument('missing', { type: 'OTHER', title: 'x' }, { tenantId: 'orion' }),
    ).rejects.toThrow('Equipment not found');
  });
});

describe('updateEquipmentDocument', () => {
  beforeEach(() => {
    findUniqueDocMock.mockReset();
    updateDocMock.mockReset();
    updateDocMock.mockResolvedValue({ id: 'doc_1' });
  });

  it('updates when equipmentId and tenantId match', async () => {
    findUniqueDocMock.mockResolvedValue({ id: 'doc_1', equipmentId: 'eq_1', tenantId: 'orion' });
    await updateEquipmentDocument('eq_1', 'doc_1', { title: 'Updated' }, { tenantId: 'orion' });
    expect(updateDocMock).toHaveBeenCalledOnce();
  });

  it('throws 404 when tenantId does not match (cross-tenant attack)', async () => {
    findUniqueDocMock.mockResolvedValue({ id: 'doc_1', equipmentId: 'eq_1', tenantId: 'orion' });
    await expect(
      updateEquipmentDocument('eq_1', 'doc_1', { title: 'x' }, { tenantId: 'tenant-b' }),
    ).rejects.toThrow('Document not found');
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('throws 404 when equipmentId does not match', async () => {
    findUniqueDocMock.mockResolvedValue({ id: 'doc_1', equipmentId: 'other_eq', tenantId: 'orion' });
    await expect(
      updateEquipmentDocument('eq_1', 'doc_1', { title: 'x' }, { tenantId: 'orion' }),
    ).rejects.toThrow('Document not found');
  });
});

describe('deleteEquipmentDocument', () => {
  beforeEach(() => {
    findUniqueDocMock.mockReset();
    deleteDocMock.mockReset();
    deleteDocMock.mockResolvedValue({ id: 'doc_1' });
  });

  it('deletes when equipmentId and tenantId match', async () => {
    findUniqueDocMock.mockResolvedValue({ id: 'doc_1', equipmentId: 'eq_1', tenantId: 'orion' });
    await deleteEquipmentDocument('eq_1', 'doc_1', { tenantId: 'orion' });
    expect(deleteDocMock).toHaveBeenCalledOnce();
  });

  it('throws 404 when tenantId does not match (cross-tenant attack)', async () => {
    findUniqueDocMock.mockResolvedValue({ id: 'doc_1', equipmentId: 'eq_1', tenantId: 'orion' });
    await expect(
      deleteEquipmentDocument('eq_1', 'doc_1', { tenantId: 'tenant-b' }),
    ).rejects.toThrow('Document not found');
    expect(deleteDocMock).not.toHaveBeenCalled();
  });
});
