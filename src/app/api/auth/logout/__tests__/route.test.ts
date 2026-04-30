/**
 * POST /api/auth/logout — behavioural tests.
 *
 * Pin the audit trail: every logout must record an audit event when a
 * session is present, so revocation can be traced. Anonymous calls
 * (already-expired session) should still succeed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { requireAuthMock, createLogoutMock, auditMock, tenantMock, requestIdMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  createLogoutMock: vi.fn(),
  auditMock: vi.fn().mockResolvedValue(undefined),
  tenantMock: vi.fn(() => ({ tenantId: 'tenant-1' })),
  requestIdMock: vi.fn(() => 'req-123'),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/request-context', () => ({ getRequestId: requestIdMock }));
vi.mock('@/services/auth/auth-service', () => ({ createLogoutResponse: createLogoutMock }));
vi.mock('@/services/audit/audit-service', () => ({ recordAuditEvent: auditMock }));
vi.mock('@/services/tenancy/tenant-context-service', () => ({ resolveTenantContext: tenantMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));

import { POST } from '../route';

function req(): NextRequest {
  return new NextRequest('http://localhost/api/auth/logout', { method: 'POST' });
}

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    auditMock.mockClear();
    createLogoutMock.mockReset();
    createLogoutMock.mockReturnValue(NextResponse.json({ ok: true }));
  });

  it('records an audit event with actor + tenant when authenticated', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' }, error: null });

    await POST(req());
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.logout',
      scope: 'auth',
      actorId: 'u1',
      tenantId: 'tenant-1',
      requestId: 'req-123',
      metadata: { role: 'ADMIN' },
    }));
    expect(createLogoutMock).toHaveBeenCalledWith('req-123');
  });

  it('skips the audit write when there is no session (already logged out)', async () => {
    requireAuthMock.mockResolvedValue({ user: null, error: null });

    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(auditMock).not.toHaveBeenCalled();
    // Must still produce the cookie-clearing response.
    expect(createLogoutMock).toHaveBeenCalledWith('req-123');
  });
});
