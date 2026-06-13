/**
 * GET /api/equipment/all — behavioural tests.
 * Auth-gated only (any authenticated role); pins auth + delegation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, cachedEquipmentMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  cachedEquipmentMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/cached-queries', () => ({ getCachedEquipmentAll: cachedEquipmentMock }));

import { GET } from '../route';

function req(): NextRequest {
  return new NextRequest(`http://localhost/api/equipment/all?_ts=${Date.now()}`);
}

describe('GET /api/equipment/all', () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    cachedEquipmentMock.mockReset();
  });

  it('returns 401 when there is no session', async () => {
    requireAuthMock.mockResolvedValue({ user: null, error: new Response(null, { status: 401 }) });
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(cachedEquipmentMock).not.toHaveBeenCalled();
  });

  it('returns the cached equipment for any authenticated user', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'op', role: 'OPERATOR' }, error: null });
    cachedEquipmentMock.mockResolvedValue([{ id: 'e1', name: 'Rig 1' }]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).equipment).toEqual([{ id: 'e1', name: 'Rig 1' }]);
  });
});
