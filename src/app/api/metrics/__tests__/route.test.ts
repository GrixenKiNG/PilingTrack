/**
 * GET /api/metrics — service-to-service scrape token (M-10b).
 *
 * /api/metrics required a real user session (requireAuth + assertCan
 * 'system.read'), but Prometheus's static scrape_configs can't do session
 * login — there's no cookie jar, no JWT refresh flow. Production shipped
 * with the 'pilingtrack-app' scrape job commented out in
 * observability/prometheus/prometheus-prod.yml specifically because of
 * this (see the TODO M-10b left there), so metrics were never collected.
 *
 * Fix: a separate static secret (METRICS_SCRAPE_TOKEN) checked via
 * Authorization: Bearer, constant-time compared (mirrors the existing
 * pattern in /api/alerts/webhook and auth-service.ts's constantTimeEquals —
 * this is the same secret-comparison class of bug). A valid token bypasses
 * the session check entirely; anything else (wrong token, no token,
 * env var unset) falls through to the existing session-based auth
 * unchanged, so a logged-in admin can still open /api/metrics in a
 * browser for debugging.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, assertCanMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  assertCanMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/services/auth/authorization-service', async () => {
  const actual = await vi.importActual<object>('@/services/auth/authorization-service');
  return { ...actual, assertCan: assertCanMock };
});
vi.mock('@/lib/cache-metrics', () => ({ generatePrometheusMetrics: () => '# cache metrics\n' }));
vi.mock('@/core/observability/lag-monitor', () => ({
  getLagMetrics: () => null,
  exportPrometheusMetrics: () => '',
}));
vi.mock('@/core/observability/health-tracker', () => ({ getCurrentStatus: () => null }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { GET } from '../route';

const TOKEN = 'super-secret-scrape-token';
const AUTH_ERROR = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

function req(token: string | null): NextRequest {
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new NextRequest('http://localhost/api/metrics', { headers });
}

describe('GET /api/metrics — scrape token auth', () => {
  const originalEnv = process.env.METRICS_SCRAPE_TOKEN;

  beforeEach(() => {
    requireAuthMock.mockReset();
    assertCanMock.mockReset();
    process.env.METRICS_SCRAPE_TOKEN = TOKEN;
  });
  afterEach(() => {
    process.env.METRICS_SCRAPE_TOKEN = originalEnv;
  });

  it('accepts a matching Bearer scrape token WITHOUT calling requireAuth/assertCan', async () => {
    const res = await GET(req(TOKEN));
    expect(res.status).toBe(200);
    expect(requireAuthMock).not.toHaveBeenCalled();
    expect(assertCanMock).not.toHaveBeenCalled();
  });

  it('falls back to session auth on a mismatched token', async () => {
    requireAuthMock.mockResolvedValue({ user: null, error: AUTH_ERROR });
    const res = await GET(req('wrong-token'));
    expect(res.status).toBe(401);
    expect(requireAuthMock).toHaveBeenCalled();
  });

  it('falls back to session auth on a token of different length (constant-time path correctness)', async () => {
    requireAuthMock.mockResolvedValue({ user: null, error: AUTH_ERROR });
    const res = await GET(req('short'));
    expect(res.status).toBe(401);
  });

  it('falls back to session auth when no token header is present', async () => {
    requireAuthMock.mockResolvedValue({ user: null, error: AUTH_ERROR });
    const res = await GET(req(null));
    expect(res.status).toBe(401);
  });

  it('never bypasses when METRICS_SCRAPE_TOKEN is unset — fails closed', async () => {
    delete process.env.METRICS_SCRAPE_TOKEN;
    requireAuthMock.mockResolvedValue({ user: null, error: AUTH_ERROR });
    const res = await GET(req(TOKEN));
    expect(res.status).toBe(401);
    expect(requireAuthMock).toHaveBeenCalled();
  });

  it('still serves a logged-in admin via the existing session path (no token header at all)', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' }, error: null });
    assertCanMock.mockImplementation(() => {}); // allowed, no throw
    const res = await GET(req(null));
    expect(res.status).toBe(200);
    expect(assertCanMock).toHaveBeenCalledWith({ id: 'u1', role: 'ADMIN' }, 'system.read');
  });

  it('still enforces system.read for a session without the right permission', async () => {
    const { ServiceError } = await import('@/lib/service-error');
    requireAuthMock.mockResolvedValue({ user: { id: 'u2', role: 'OPERATOR' }, error: null });
    assertCanMock.mockImplementation(() => { throw new ServiceError('Доступ запрещён', 403); });
    const res = await GET(req(null));
    expect(res.status).toBe(403);
  });
});
