/**
 * provisionDeviceKey — tenant scoping regression.
 *
 * Pre-existing IDOR: the equipment lookup checked only existence, not
 * tenantId — an ADMIN/DISPATCHER from tenant A could mint a working device
 * key (a powerful credential — authenticates telemetry ingestion) bound to
 * tenant B's equipment.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUniqueMock, createMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  createMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: { equipment: { findUnique: findUniqueMock }, deviceKey: { create: createMock } },
}));

import { provisionDeviceKey } from '../device-key-service';

describe('provisionDeviceKey — tenant scoping', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    createMock.mockReset();
  });

  it('rejects when tenantId is missing (fail-closed)', async () => {
    await expect(
      provisionDeviceKey({ name: 'x', equipmentId: 'eq-1', tenantId: '' })
    ).rejects.toThrow('tenantId is required');
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it('scopes the equipment lookup by tenantId, not id alone', async () => {
    findUniqueMock.mockResolvedValue(null);

    await expect(
      provisionDeviceKey({ name: 'x', equipmentId: 'eq-1', tenantId: 'tenant-a' })
    ).rejects.toThrow('Equipment not found');

    expect(findUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'eq-1', tenantId: 'tenant-a' } })
    );
    expect(createMock).not.toHaveBeenCalled();
  });

  it('provisions a key when the equipment belongs to the caller tenant', async () => {
    findUniqueMock.mockResolvedValue({ id: 'eq-1', isActive: true });
    createMock.mockResolvedValue({ id: 'key-1', name: 'x', equipmentId: 'eq-1', tenantId: 'tenant-a', siteId: null });

    const result = await provisionDeviceKey({ name: 'x', equipmentId: 'eq-1', tenantId: 'tenant-a' });

    expect(result.id).toBe('key-1');
    expect(createMock).toHaveBeenCalled();
  });
});
