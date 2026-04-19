/**
 * PIN auth route — behavioural tests.
 *
 * Security-critical per CLAUDE.md (timing-attack surface). Verifies that
 * the route: validates PIN shape, rate-limits by client identifier (not PIN
 * value, to prevent "try all PINs from one IP" brute force), audits every
 * terminal outcome, and never returns user data on failure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { authenticateMock, createResponseMock, auditMock, tenantMock, rateLimitIdMock } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  createResponseMock: vi.fn(),
  auditMock: vi.fn().mockResolvedValue(undefined),
  tenantMock: vi.fn(() => ({ tenantId: 'tenant-1' })),
  rateLimitIdMock: vi.fn(() => 'ip:1.2.3.4|tenant:tenant-1'),
}));

vi.mock('@/services/auth/auth-service', () => ({
  authenticateUserByPin: authenticateMock,
  createAuthenticatedResponse: createResponseMock,
}));

vi.mock('@/services/audit/audit-service', () => ({ recordAuditEvent: auditMock }));
vi.mock('@/services/tenancy/tenant-context-service', () => ({ resolveTenantContext: tenantMock }));
vi.mock('@/lib/rate-limiter', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rate-limiter')>('@/lib/rate-limiter');
  return { ...actual, getRateLimitIdentifier: rateLimitIdMock };
});
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));

import { POST } from '../route';

function pinRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/auth/pin', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/pin', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    createResponseMock.mockReset();
    auditMock.mockClear();
    rateLimitIdMock.mockClear();
    createResponseMock.mockResolvedValue(NextResponse.json({ ok: true }));
  });

  it('returns 400 when PIN contains non-digits', async () => {
    const res = await POST(pinRequest({ pin: '12a4' }));
    expect(res.status).toBe(400);
    expect(authenticateMock).not.toHaveBeenCalled();
  });

  it('returns 400 on missing PIN', async () => {
    const res = await POST(pinRequest({}));
    expect(res.status).toBe(400);
    expect(authenticateMock).not.toHaveBeenCalled();
  });

  it('rate-limits by client identifier, not PIN value', async () => {
    authenticateMock.mockResolvedValue({ user: null, rateLimited: false });
    await POST(pinRequest({ pin: '1234' }));

    expect(rateLimitIdMock).toHaveBeenCalledWith(
      expect.anything(),
      'unknown',
      { includeTenant: true },
    );
    expect(authenticateMock).toHaveBeenCalledWith('1234', 'ip:1.2.3.4|tenant:tenant-1');
  });

  it('returns 429 when rate-limited and audits', async () => {
    authenticateMock.mockResolvedValue({
      rateLimited: true,
      retryAfter: 30,
      user: null,
      error: 'Too many PIN attempts',
    });

    const res = await POST(pinRequest({ pin: '1234' }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.retryAfter).toBe(30);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.pin.rate_limited',
    }));
  });

  it('returns 401 on invalid PIN without leaking user data', async () => {
    authenticateMock.mockResolvedValue({ user: null, rateLimited: false });

    const res = await POST(pinRequest({ pin: '9999' }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Invalid PIN');
    expect(body).not.toHaveProperty('user');
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.pin.failed',
    }));
  });

  it('delegates to createAuthenticatedResponse on success', async () => {
    const user = { id: 'u1', email: 'op@piling.ru', name: 'Op', role: 'OPERATOR' };
    authenticateMock.mockResolvedValue({ user, rateLimited: false });

    await POST(pinRequest({ pin: '1234' }));

    expect(createResponseMock).toHaveBeenCalledWith(user, expect.any(String));
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.pin.succeeded',
      actorId: 'u1',
    }));
  });
});
