/**
 * GET/DELETE /api/equipment/[id]/device-keys — tenant scoping regression.
 *
 * Both routes used to query by equipmentId alone, with no tenant check —
 * any ADMIN/DISPATCHER could list or revoke another tenant's device keys
 * (the credential telemetry ingestion authenticates with) just by knowing
 * an equipmentId. requireTenantEquipment() now gates both.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, findUniqueEquipmentMock, findManyKeysMock, findUniqueKeyMock, revokeDeviceKeyMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  findUniqueEquipmentMock: vi.fn(),
  findManyKeysMock: vi.fn(),
  findUniqueKeyMock: vi.fn(),
  revokeDeviceKeyMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/lib/db', () => ({
  db: {
    equipment: { findUnique: findUniqueEquipmentMock },
    deviceKey: { findMany: findManyKeysMock, findUnique: findUniqueKeyMock },
  },
}));
vi.mock('@/services/telemetry/device-key-service', () => ({
  provisionDeviceKey: vi.fn(),
  revokeDeviceKey: revokeDeviceKeyMock,
}));

import { GET, DELETE } from '../route';

const ADMIN = { id: 'admin-1', role: 'ADMIN', tenantId: 'tenant-a' };

function getReq(): NextRequest {
  return new NextRequest('http://localhost/api/equipment/eq-1/device-keys');
}
function deleteReq(keyId: string): NextRequest {
  return new NextRequest('http://localhost/api/equipment/eq-1/device-keys', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ keyId }),
  });
}
function params() {
  return { params: Promise.resolve({ id: 'eq-1' }) };
}

describe('GET /api/equipment/[id]/device-keys — tenant scoping', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
  });

  it('rejects (404) when the equipment does not belong to the caller tenant', async () => {
    findUniqueEquipmentMock.mockResolvedValue(null);

    const res = await GET(getReq(), params());

    expect(res.status).toBe(404);
    expect(findManyKeysMock).not.toHaveBeenCalled();
  });

  it('lists keys when the equipment belongs to the caller tenant', async () => {
    findUniqueEquipmentMock.mockResolvedValue({ id: 'eq-1' });
    findManyKeysMock.mockResolvedValue([]);

    const res = await GET(getReq(), params());

    expect(res.status).toBe(200);
    expect(findUniqueEquipmentMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'eq-1', tenantId: 'tenant-a' } })
    );
  });
});

describe('DELETE /api/equipment/[id]/device-keys — tenant scoping', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
  });

  it('rejects (404) when the equipment does not belong to the caller tenant, without revoking', async () => {
    findUniqueEquipmentMock.mockResolvedValue(null);

    const res = await DELETE(deleteReq('key-1'), params());

    expect(res.status).toBe(404);
    expect(findUniqueKeyMock).not.toHaveBeenCalled();
    expect(revokeDeviceKeyMock).not.toHaveBeenCalled();
  });

  it('revokes the key when the equipment belongs to the caller tenant', async () => {
    findUniqueEquipmentMock.mockResolvedValue({ id: 'eq-1' });
    findUniqueKeyMock.mockResolvedValue({ equipmentId: 'eq-1' });

    const res = await DELETE(deleteReq('key-1'), params());

    expect(res.status).toBe(200);
    expect(revokeDeviceKeyMock).toHaveBeenCalledWith('key-1');
  });
});
