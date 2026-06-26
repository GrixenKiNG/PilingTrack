/**
 * GET/POST /api/tenancy/billing — behavioural tests.
 *
 * Pins the tenantId IDOR fix (c58ef71): tenantId must always come from the
 * session, never from the query string or request body, even for an ADMIN.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, getStatsMock, activateMock, cancelMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getStatsMock: vi.fn(),
  activateMock: vi.fn(),
  cancelMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/services/tenancy/tenant-billing-service', () => ({
  getTenantDashboardStats: getStatsMock,
  activateSubscription: activateMock,
  cancelSubscription: cancelMock,
  PLANS: { free: { id: 'free', name: 'Free' }, pro: { id: 'pro', name: 'Pro' } },
}));

import { GET, POST } from '../route';

function getReq(qs = ''): NextRequest {
  return new NextRequest(`http://localhost/api/tenancy/billing${qs}`);
}

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/tenancy/billing', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/tenancy/billing', () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    getStatsMock.mockReset();
  });

  it('returns 401 when there is no session', async () => {
    requireAuthMock.mockResolvedValue({ user: null, error: new Response(null, { status: 401 }) });
    const res = await GET(getReq());
    expect(res.status).toBe(401);
  });

  it('fails closed when the session has no tenantId', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'a', role: 'ADMIN', tenantId: null }, error: null });
    const res = await GET(getReq());
    expect(res.status).toBe(400);
    expect(getStatsMock).not.toHaveBeenCalled();
  });

  it('scopes stats to the session tenantId, ignoring a query-string tenantId override', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'a', role: 'ADMIN', tenantId: 'tenant-a' }, error: null });
    getStatsMock.mockResolvedValue({ tenant: { id: 'tenant-a' }, userCount: 1, siteCount: 1, reportCount: 0, currentMonthReports: 0, invoices: [] });

    const res = await GET(getReq('?tenantId=tenant-b'));
    expect(res.status).toBe(200);
    expect(getStatsMock).toHaveBeenCalledWith('tenant-a');
    expect(getStatsMock).not.toHaveBeenCalledWith('tenant-b');
  });
});

describe('POST /api/tenancy/billing', () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    activateMock.mockReset();
    cancelMock.mockReset();
  });

  it('returns 401 when there is no session', async () => {
    requireAuthMock.mockResolvedValue({ user: null, error: new Response(null, { status: 401 }) });
    const res = await POST(postReq({ action: 'activate', planId: 'pro' }));
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-ADMIN', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'op', role: 'OPERATOR', tenantId: 'tenant-a' }, error: null });
    const res = await POST(postReq({ action: 'activate', planId: 'pro' }));
    expect(res.status).toBe(403);
    expect(activateMock).not.toHaveBeenCalled();
  });

  it('fails closed when the session has no tenantId', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'a', role: 'ADMIN', tenantId: null }, error: null });
    const res = await POST(postReq({ action: 'activate', planId: 'pro' }));
    expect(res.status).toBe(400);
    expect(activateMock).not.toHaveBeenCalled();
  });

  it('activates the session tenant, ignoring a body-supplied tenantId override', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'a', role: 'ADMIN', tenantId: 'tenant-a' }, error: null });
    activateMock.mockResolvedValue({ id: 'tenant-a', plan: 'pro' });

    const res = await POST(postReq({ action: 'activate', planId: 'pro', tenantId: 'tenant-b' }));
    expect(res.status).toBe(200);
    expect(activateMock).toHaveBeenCalledWith('tenant-a', 'pro');
  });

  it('returns 400 for an unknown plan', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'a', role: 'ADMIN', tenantId: 'tenant-a' }, error: null });
    const res = await POST(postReq({ action: 'activate', planId: 'not-a-plan' }));
    expect(res.status).toBe(400);
    expect(activateMock).not.toHaveBeenCalled();
  });

  it('cancels the session tenant, ignoring a body-supplied tenantId override', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'a', role: 'ADMIN', tenantId: 'tenant-a' }, error: null });
    cancelMock.mockResolvedValue({ id: 'tenant-a', subscriptionStatus: 'canceled' });

    const res = await POST(postReq({ action: 'cancel', reason: 'too expensive', tenantId: 'tenant-b' }));
    expect(res.status).toBe(200);
    expect(cancelMock).toHaveBeenCalledWith('tenant-a', 'too expensive');
  });

  it('returns 400 for an unknown action', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'a', role: 'ADMIN', tenantId: 'tenant-a' }, error: null });
    const res = await POST(postReq({ action: 'frobnicate' }));
    expect(res.status).toBe(400);
    expect(activateMock).not.toHaveBeenCalled();
    expect(cancelMock).not.toHaveBeenCalled();
  });
});
