import { describe, it, expect, vi, beforeEach } from 'vitest';
const { findManyUserMock, createUserMock } = vi.hoisted(() => ({
  findManyUserMock: vi.fn(),
  createUserMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  db: { user: { findMany: findManyUserMock, create: createUserMock } },
}));
vi.mock('@/services/auth/auth-service', () => ({ hashPassword: vi.fn(async () => 'hashed') }));
vi.mock('@/services/audit/audit-service', () => ({ recordAuditEvent: vi.fn(async () => undefined) }));
import { listAssignableUsers, createUser } from '../user-service';

describe('listAssignableUsers', () => {
  beforeEach(() => { findManyUserMock.mockReset(); findManyUserMock.mockResolvedValue([]); });
  it('scopes to active users of the tenant', async () => {
    await listAssignableUsers('orion');
    const arg = findManyUserMock.mock.calls[0][0];
    expect(arg.where).toEqual({ tenantId: 'orion', isActive: true });
    expect(arg.select).toEqual({ id: true, name: true, role: true });
  });
  it('throws when tenantId empty (fail-closed)', async () => {
    await expect(listAssignableUsers('')).rejects.toThrow();
  });
});

describe('createUser', () => {
  beforeEach(() => {
    createUserMock.mockReset();
    createUserMock.mockResolvedValue({ id: 'u1', email: 'a@b.ru', name: 'A', phone: '', role: 'OPERATOR', isActive: true });
  });

  it('persists the actor tenantId so the NOT NULL column is satisfied', async () => {
    await createUser(
      { email: 'a@b.ru', password: 'pw', name: 'A', role: 'OPERATOR', tenantId: 'orion' },
      'admin-1'
    );
    const arg = createUserMock.mock.calls[0][0];
    expect(arg.data.tenantId).toBe('orion');
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
