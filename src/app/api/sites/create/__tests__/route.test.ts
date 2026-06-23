/**
 * POST /api/sites/create — behavioural tests (withMutation path).
 *
 * Pins: CSRF/rate-limit wrapper passthrough, the sites.manage boundary, zod
 * validation (400 on bad body), and the 201 create path delegating to
 * createSiteWithPlans + cache invalidation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, createSiteMock, invalidateMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  createSiteMock: vi.fn(),
  invalidateMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/modules/sites', () => ({ createSiteWithPlans: createSiteMock }));
vi.mock('@/lib/cached-queries', () => ({ invalidateSites: invalidateMock }));
vi.mock('@/core/infrastructure/circuit-breakers', async () => {
  const actual = await vi.importActual<object>('@/core/infrastructure/circuit-breakers');
  return { ...actual, withDbProtection: (fn: () => unknown) => fn() };
});

import { POST } from '../route';

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/sites/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/sites/create', () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    createSiteMock.mockReset();
    invalidateMock.mockReset().mockResolvedValue(undefined);
  });

  it('returns 401 when there is no session', async () => {
    requireAuthMock.mockResolvedValue({ user: null, error: new Response(null, { status: 401 }) });
    const res = await POST(req({ name: 'Site A' }));
    expect(res.status).toBe(401);
  });

  it('returns 403 for an OPERATOR (lacks sites.manage)', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'op', role: 'OPERATOR' }, error: null });
    const res = await POST(req({ name: 'Site A' }));
    expect(res.status).toBe(403);
    expect(createSiteMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the body fails validation (missing name)', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'a', role: 'ADMIN', tenantId: 'tenant-a' }, error: null });
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Validation failed');
    expect(createSiteMock).not.toHaveBeenCalled();
  });

  it('creates the site (201) and invalidates the cache', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'a', role: 'ADMIN', tenantId: 'tenant-a' }, error: null });
    createSiteMock.mockResolvedValue({ id: 's1', name: 'Site A' });

    const res = await POST(req({ name: 'Site A' }));
    expect(res.status).toBe(201);
    expect((await res.json()).site).toEqual({ id: 's1', name: 'Site A' });
    expect(createSiteMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Site A' }),
      { tenantId: 'tenant-a', actorId: 'a' },
    );
    expect(invalidateMock).toHaveBeenCalled();
  });

  it('fails closed when tenant context is missing', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'a', role: 'ADMIN', tenantId: null }, error: null });
    const res = await POST(req({ name: 'Site A' }));
    expect(res.status).toBe(400);
    expect(createSiteMock).not.toHaveBeenCalled();
  });
});
