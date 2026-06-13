import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, getHistoryMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getHistoryMock: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/services/reports/report-history-service', () => ({ getReportHistory: getHistoryMock }));

import { GET } from '../route';

function req(): NextRequest { return new NextRequest('http://localhost/api/reports/rep-1/history'); }
const ctx = () => ({ params: Promise.resolve({ id: 'rep-1' }) });

describe('GET /api/reports/[id]/history', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 401 when unauthenticated', async () => {
    requireAuthMock.mockResolvedValue({ user: null, error: new Response(null, { status: 401 }) });
    expect((await GET(req(), ctx())).status).toBe(401);
  });

  it('returns 403 for an OPERATOR', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'o', role: 'OPERATOR' }, error: null });
    expect((await GET(req(), ctx())).status).toBe(403);
    expect(getHistoryMock).not.toHaveBeenCalled();
  });

  it('returns history for an ADMIN keyed on the [id] param', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'a', role: 'ADMIN' }, error: null });
    getHistoryMock.mockResolvedValue({ events: [{ id: 'a1' }], versions: [] });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ events: [{ id: 'a1' }], versions: [] });
    expect(getHistoryMock).toHaveBeenCalledWith('rep-1');
  });
});
