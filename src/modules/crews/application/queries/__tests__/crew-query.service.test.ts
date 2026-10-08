/**
 * Crew Query Service — tenant-scoping tests.
 *
 * Pins the IDOR guard: getAccessibleCrews must scope every list to the
 * caller's tenant via site.tenantId, and fail closed when tenantId is absent.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getAccessibleCrews, getCrewForOperator } from '../crew-query.service';

const mockDb = {
  crew: {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
  },
};

vi.mock('@/lib/db', () => ({
  get db() { return mockDb; },
}));

describe('getAccessibleCrews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.crew.findMany.mockResolvedValue([]);
  });

  it('scopes the query to the caller tenant via site.tenantId', async () => {
    await getAccessibleCrews('orion');

    const where = mockDb.crew.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ site: { tenantId: 'orion' } });
  });

  it('combines tenant scope with the optional siteId filter', async () => {
    await getAccessibleCrews('orion', 'site-1');

    const where = mockDb.crew.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ site: { tenantId: 'orion' }, siteId: 'site-1' });
  });

  it('fails closed when tenantId is empty (IDOR guard)', async () => {
    await expect(getAccessibleCrews('')).rejects.toThrow('Не определена организация пользователя');
    expect(mockDb.crew.findMany).not.toHaveBeenCalled();
  });
});

describe('getCrewForOperator — исполняемая роль', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['OPERATOR', undefined, 'actor-1'],
    ['ADMIN', 'OPERATOR', 'actor-1'],
    ['ADMIN', undefined, 'other-operator'],
    ['DISPATCHER', undefined, 'other-operator'],
  ])('role=%s actingAs=%s looks up %s', async (role, actingAs, expectedId) => {
    await getCrewForOperator({ id: 'actor-1', role, actingAs }, 'other-operator');
    expect(mockDb.crew.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [
        { operatorId: expectedId },
        { assistants: { some: { userId: expectedId } } },
      ] },
    }));
  });
});
