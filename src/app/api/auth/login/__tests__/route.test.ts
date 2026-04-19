/**
 * Login route — behavioural tests.
 *
 * Exercises the real route handler with mocked auth + audit services.
 * Covers the security-sensitive paths: validation, rate-limit, bad creds,
 * and the happy-path 200 with session cookie.
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
  authenticateUserByEmailPassword: authenticateMock,
  createAuthenticatedResponse: createResponseMock,
}));

vi.mock('@/services/audit/audit-service', () => ({
  recordAuditEvent: auditMock,
}));

vi.mock('@/services/tenancy/tenant-context-service', () => ({
  resolveTenantContext: tenantMock,
}));

vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));

import { POST } from '../route';

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    createResponseMock.mockReset();
    auditMock.mockClear();
    createResponseMock.mockResolvedValue(NextResponse.json({ ok: true }));
  });

  it('returns 400 on malformed email', async () => {
    const res = await POST(jsonRequest({ email: 'not-an-email', password: 'x'.repeat(8) }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(authenticateMock).not.toHaveBeenCalled();
  });

  it('returns 400 on missing password', async () => {
    const res = await POST(jsonRequest({ email: 'a@b.ru' }));
    expect(res.status).toBe(400);
    expect(authenticateMock).not.toHaveBeenCalled();
  });

  it('returns 429 with retryAfter when rate-limited', async () => {
    authenticateMock.mockResolvedValue({ rateLimited: true, retryAfter: 42, user: null });
    const res = await POST(jsonRequest({ email: 'a@b.ru', password: 'password123' }));

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.retryAfter).toBe(42);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.login.rate_limited',
    }));
  });

  it('returns 401 on bad credentials and audits the failure', async () => {
    authenticateMock.mockResolvedValue({ user: null, rateLimited: false });
    const res = await POST(jsonRequest({ email: 'a@b.ru', password: 'password123' }));

    expect(res.status).toBe(401);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.login.failed',
    }));
  });

  it('normalises email to lowercase before authenticating', async () => {
    authenticateMock.mockResolvedValue({ user: null, rateLimited: false });
    await POST(jsonRequest({ email: 'Admin@Piling.RU', password: 'password123' }));

    expect(authenticateMock).toHaveBeenCalledWith('admin@piling.ru', 'password123');
  });

  it('delegates to createAuthenticatedResponse on success and audits', async () => {
    const user = { id: 'u1', email: 'a@b.ru', name: 'A', role: 'ADMIN' };
    authenticateMock.mockResolvedValue({ user, rateLimited: false });

    await POST(jsonRequest({ email: 'a@b.ru', password: 'password123' }));

    expect(createResponseMock).toHaveBeenCalledWith(user, expect.any(String));
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.login.succeeded',
      actorId: 'u1',
    }));
  });
});
