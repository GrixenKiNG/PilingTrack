/**
 * GET /api/crews/all — behavioural tests.
 * crews.legacy_manage is ADMIN-only; pin that boundary + delegation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, cachedCrewsMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  cachedCrewsMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/cached-queries', () => ({ getCachedCrewsAll: cachedCrewsMock }));

import { GET } from '../route';

function req(): NextRequest {
  return new NextRequest(`http://localhost/api/crews/all?_ts=${Date.now()}`);
}

describe('GET /api/crews/all', () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    cachedCrewsMock.mockReset();
  });

  it('returns 401 when there is no session', async () => {
    requireAuthMock.mockResolvedValue({ user: null, error: new Response(null, { status: 401 }) });
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it('returns 403 for a DISPATCHER (crews.legacy_manage is ADMIN-only)', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'd', role: 'DISPATCHER' }, error: null });
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(cachedCrewsMock).not.toHaveBeenCalled();
  });

  it('returns the cached crews for an ADMIN', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'a', role: 'ADMIN' }, error: null });
    cachedCrewsMock.mockResolvedValue([{ id: 'c1', name: 'Crew A' }]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).crews).toEqual([{ id: 'c1', name: 'Crew A' }]);
  });
});
