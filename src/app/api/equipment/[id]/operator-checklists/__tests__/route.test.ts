import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, assertCanMock, listMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(), assertCanMock: vi.fn(), listMock: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/services/auth/authorization-service', () => ({ assertCan: assertCanMock }));
vi.mock('@/modules/operator-mobile', () => ({ listEquipmentChecklistHistory: listMock }));
vi.mock('@/lib/tenant', () => ({ requireTenantId: (user: { tenantId: string }) => user.tenantId }));

import { GET } from '../route';

const call = () => GET(
  new NextRequest('http://localhost/api/equipment/eq-1/operator-checklists'),
  { params: Promise.resolve({ id: 'eq-1' }) },
);

beforeEach(() => {
  [requireAuthMock, assertCanMock, listMock].forEach((fn) => fn.mockReset());
  requireAuthMock.mockResolvedValue({ user: { id: 'u', role: 'MECHANIC', tenantId: 'orion' }, error: null });
  listMock.mockResolvedValue([{ id: 'e1' }]);
});

describe('GET /api/equipment/[id]/operator-checklists', () => {
  it('читает историю по организации пользователя и требует право equipment.read', async () => {
    const response = await call();

    expect(assertCanMock).toHaveBeenCalledWith(expect.objectContaining({ role: 'MECHANIC' }), 'equipment.read');
    expect(listMock).toHaveBeenCalledWith({ tenantId: 'orion', equipmentId: 'eq-1' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ records: [{ id: 'e1' }] });
  });

  it('без входа возвращает ответ авторизации и ничего не читает', async () => {
    requireAuthMock.mockResolvedValue({ user: null, error: new Response(null, { status: 401 }) });
    const response = await call();

    expect(response.status).toBe(401);
    expect(listMock).not.toHaveBeenCalled();
  });
});
