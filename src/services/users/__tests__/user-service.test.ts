import { describe, it, expect, vi, beforeEach } from 'vitest';
const { createUserMock } = vi.hoisted(() => ({ createUserMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { user: { create: createUserMock } } }));
vi.mock('@/services/auth/auth-service', () => ({ hashPassword: vi.fn(async () => 'hashed') }));
vi.mock('@/services/audit/audit-service', () => ({ recordAuditEvent: vi.fn(async () => undefined) }));
import { createUser } from '../user-service';

describe('createUser tenant scoping', () => {
  beforeEach(() => {
    createUserMock.mockReset();
    createUserMock.mockResolvedValue({ id: 'u1', email: 'a@b.ru', name: 'A', phone: '', role: 'OPERATOR', isActive: true });
  });

  it('persists the actor tenantId so the NOT NULL column is satisfied', async () => {
    await createUser(
      { email: 'a@b.ru', password: 'pw', name: 'A', role: 'OPERATOR', tenantId: 'orion' },
      'admin-1'
    );
    expect(createUserMock.mock.calls[0][0].data.tenantId).toBe('orion');
  });

  it('falls back to DEFAULT_TENANT_ID when the actor tenant is missing', async () => {
    const prev = process.env.DEFAULT_TENANT_ID;
    process.env.DEFAULT_TENANT_ID = 'orion';
    await createUser({ email: 'a@b.ru', password: 'pw', name: 'A', tenantId: null }, 'admin-1');
    expect(createUserMock.mock.calls[0][0].data.tenantId).toBe('orion');
    process.env.DEFAULT_TENANT_ID = prev;
  });

  it('fails closed (no NULL insert) when no tenant can be resolved', async () => {
    const prev = process.env.DEFAULT_TENANT_ID;
    delete process.env.DEFAULT_TENANT_ID;
    await expect(
      createUser({ email: 'a@b.ru', password: 'pw', name: 'A', tenantId: null }, 'admin-1')
    ).rejects.toThrow();
    expect(createUserMock).not.toHaveBeenCalled();
    process.env.DEFAULT_TENANT_ID = prev;
  });
});
