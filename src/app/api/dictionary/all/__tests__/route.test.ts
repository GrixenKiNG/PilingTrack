import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getCachedAllDictionaries: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/cached-queries', () => ({
  getCachedAllDictionaries: mocks.getCachedAllDictionaries,
}));

import { GET } from '../route';

describe('dictionary/all route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({
      user: { id: 'u1', role: 'OPERATOR', tenantId: 'tenant-a' },
      error: null,
    });
    mocks.getCachedAllDictionaries.mockResolvedValue({
      pileGrades: [], drillingTypes: [], downtimeReasons: [],
    });
  });

  it('loads active dictionaries from the authenticated tenant cache', async () => {
    const response = await GET(new NextRequest('http://localhost/api/dictionary/all'));

    expect(response.status).toBe(200);
    expect(mocks.getCachedAllDictionaries).toHaveBeenCalledWith('tenant-a');
  });

  it('fails closed when the user has no tenant', async () => {
    mocks.requireAuth.mockResolvedValue({
      user: { id: 'u1', role: 'OPERATOR', tenantId: null }, error: null,
    });

    const response = await GET(new NextRequest('http://localhost/api/dictionary/all'));

    expect(response.status).toBe(400);
    expect(mocks.getCachedAllDictionaries).not.toHaveBeenCalled();
  });
});
