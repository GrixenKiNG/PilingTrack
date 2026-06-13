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

const { authenticateMock, createResponseMock, auditMock, tenantMock } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  createResponseMock: vi.fn(),
  auditMock: vi.fn().mockResolvedValue(undefined),
  tenantMock: vi.fn(() => ({ tenantId: 'tenant-1' })),
}));

vi.mock('@/services/auth/auth-service', () => ({
  authenticateUserByPin: authenticateMock,
  createAuthenticatedResponse: createResponseMock,
}));

vi.mock('@/services/audit/audit-service', () => ({ recordAuditEvent: auditMock }));
vi.mock('@/services/tenancy/tenant-context-service', () => ({ resolveTenantContext: tenantMock }));
// NOTE: getRateLimitIdentifier is intentionally NOT mocked — the bucketing
// behaviour (must ignore the client-controlled x-tenant-id header) is part of
// this route's security contract and is asserted directly below.
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));

import { POST } from '../route';

function pinRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/auth/pin', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/pin', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    createResponseMock.mockReset();
    auditMock.mockClear();
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

    // Identifier is derived from the client (IP/host), never from the PIN —
    // prevents a "try all PINs from one IP" brute force.
    const [pinArg, identifier] = authenticateMock.mock.calls[0];
    expect(pinArg).toBe('1234');
    expect(identifier).toEqual(expect.any(String));
  });

  it('does not let a rotated x-tenant-id header fragment the rate-limit bucket', async () => {
    // Pre-auth, x-tenant-id is attacker-controlled. If it partitioned the
    // bucket, an attacker would mint a fresh PIN-attempt allowance per value.
    authenticateMock.mockResolvedValue({ user: null, rateLimited: false });

    await POST(pinRequest({ pin: '1111' }, { 'x-tenant-id': 'attacker-1' }));
    await POST(pinRequest({ pin: '2222' }, { 'x-tenant-id': 'attacker-2' }));

    const idA = authenticateMock.mock.calls[0][1];
    const idB = authenticateMock.mock.calls[1][1];
    expect(idA).toBe(idB);
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
