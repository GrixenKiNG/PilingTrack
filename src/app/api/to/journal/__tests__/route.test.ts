/**
 * GET /api/to/journal — behavioural tests.
 * Unified maintenance journal for one machine. Pins the maintenance.manage
 * boundary, the required equipmentId guard, and tenant-scoped delegation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, listJournalMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  listJournalMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/modules/inspections', () => ({ listToJournal: listJournalMock }));

import { GET } from '../route';

function req(qs = ''): NextRequest {
  return new NextRequest(`http://localhost/api/to/journal${qs ? `?${qs}` : ''}`);
}

describe('GET /api/to/journal', () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    listJournalMock.mockReset();
  });

  it('returns 401 when there is no session', async () => {
    requireAuthMock.mockResolvedValue({ user: null, error: new Response(null, { status: 401 }) });
    expect((await GET(req('equipmentId=e1'))).status).toBe(401);
  });

  it('returns 403 for an OPERATOR (lacks maintenance.manage)', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'op', role: 'OPERATOR' }, error: null });
    expect((await GET(req('equipmentId=e1'))).status).toBe(403);
    expect(listJournalMock).not.toHaveBeenCalled();
  });

  it('returns 400 when equipmentId is missing', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'a', role: 'ADMIN', tenantId: 'orion' }, error: null });
    expect((await GET(req())).status).toBe(400);
    expect(listJournalMock).not.toHaveBeenCalled();
  });

  it('returns the tenant-scoped journal for a maintainer', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'a', role: 'ADMIN', tenantId: 'orion' }, error: null });
    listJournalMock.mockResolvedValue([{ id: 'j1' }]);

    const res = await GET(req('equipmentId=e1'));
    expect(res.status).toBe(200);
    expect((await res.json()).records).toEqual([{ id: 'j1' }]);
    expect(listJournalMock).toHaveBeenCalledWith('orion', 'e1');
  });
});
