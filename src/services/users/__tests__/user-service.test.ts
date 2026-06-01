import { describe, it, expect, vi, beforeEach } from 'vitest';
const { findManyUserMock } = vi.hoisted(() => ({ findManyUserMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { user: { findMany: findManyUserMock } } }));
import { listAssignableUsers } from '../user-service';

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
