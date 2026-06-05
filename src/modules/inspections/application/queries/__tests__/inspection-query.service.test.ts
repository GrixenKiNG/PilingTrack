import { describe, it, expect, vi, beforeEach } from 'vitest';
const { findManyMock, findUniqueMock } = vi.hoisted(() => ({ findManyMock: vi.fn(), findUniqueMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { inspection: { findMany: findManyMock, findUnique: findUniqueMock } } }));
import { listInspections, getInspection } from '../inspection-query.service';

beforeEach(() => { findManyMock.mockReset(); findManyMock.mockResolvedValue([]); findUniqueMock.mockReset(); });

describe('listInspections', () => {
  it('scopes to tenant; equipment filter applied', async () => {
    await listInspections('orion', { equipmentId: 'eq1' }, null);
    expect(findManyMock.mock.calls[0][0].where).toMatchObject({ tenantId: 'orion', equipmentId: 'eq1' });
  });
  it('operator sees only own inspections', async () => {
    await listInspections('orion', {}, 'op1');
    expect(findManyMock.mock.calls[0][0].where).toMatchObject({ tenantId: 'orion', performedById: 'op1' });
  });
  it('throws when tenantId empty', async () => {
    await expect(listInspections('', {}, null)).rejects.toThrow();
  });
});

describe('getInspection', () => {
  it('throws 404 cross-tenant', async () => {
    findUniqueMock.mockResolvedValue({ id: 'i1', tenantId: 'other' });
    await expect(getInspection('i1', 'orion')).rejects.toThrow('not found');
  });
});
