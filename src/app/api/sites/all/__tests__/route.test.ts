/**
 * GET /api/sites/all — behavioural tests.
 * Pins the sites.read_all boundary and delegation to the cached query.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, cachedSitesMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  cachedSitesMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/cached-queries', () => ({ getCachedSitesAll: cachedSitesMock }));

import { GET } from '../route';

function req(): NextRequest {
  return new NextRequest(`http://localhost/api/sites/all?_ts=${Date.now()}`);
}

describe('GET /api/sites/all', () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    cachedSitesMock.mockReset();
  });

  it('returns 401 when there is no session', async () => {
    requireAuthMock.mockResolvedValue({ user: null, error: new Response(null, { status: 401 }) });
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(cachedSitesMock).not.toHaveBeenCalled();
  });

  it('returns 403 for an OPERATOR (lacks sites.read_all)', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'op', role: 'OPERATOR' }, error: null });
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(cachedSitesMock).not.toHaveBeenCalled();
  });

  it('returns the cached sites for a DISPATCHER', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'd', role: 'DISPATCHER' }, error: null });
    cachedSitesMock.mockResolvedValue([{ id: 's1', name: 'Site A' }]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).sites).toEqual([{ id: 's1', name: 'Site A' }]);
  });
});
