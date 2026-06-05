import { describe, it, expect, vi, beforeEach } from 'vitest';
const { findManyMock, findUniqueMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(), findUniqueMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  db: { checklistTemplate: { findMany: findManyMock, findUnique: findUniqueMock } },
}));
import { listTemplates, getTemplate } from '../template-query.service';

describe('listTemplates', () => {
  beforeEach(() => { findManyMock.mockReset(); findManyMock.mockResolvedValue([]); });
  it('scopes to tenant and active, supports level filter', async () => {
    await listTemplates('orion', { level: 'EO' });
    const arg = findManyMock.mock.calls[0][0];
    expect(arg.where).toEqual({ tenantId: 'orion', isActive: true, level: 'EO' });
  });
  it('throws when tenantId empty (fail-closed)', async () => {
    await expect(listTemplates('', {})).rejects.toThrow();
  });
});

describe('getTemplate', () => {
  beforeEach(() => { findUniqueMock.mockReset(); });
  it('returns template with sections+items when tenant matches', async () => {
    findUniqueMock.mockResolvedValue({ id: 't1', tenantId: 'orion', sections: [] });
    const t = await getTemplate('t1', 'orion');
    expect(t.id).toBe('t1');
  });
  it('throws 404 on cross-tenant', async () => {
    findUniqueMock.mockResolvedValue({ id: 't1', tenantId: 'other' });
    await expect(getTemplate('t1', 'orion')).rejects.toThrow('not found');
  });
});
