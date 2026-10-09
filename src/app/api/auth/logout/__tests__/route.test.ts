/**
 * POST /api/auth/logout — behavioural tests.
 *
 * Pin the audit trail: every logout must record an audit event when a
 * session is present, so revocation can be traced. Anonymous calls
 * (already-expired session) should still succeed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { requireAuthMock, createLogoutMock, auditMock, tenantMock, requestIdMock, readMock, revokeMock, clearMock, localLogoutMock, toastMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(), readMock: vi.fn(), revokeMock: vi.fn(), clearMock: vi.fn(), localLogoutMock: vi.fn(), toastMock: vi.fn(),
  createLogoutMock: vi.fn(),
  auditMock: vi.fn().mockResolvedValue(undefined),
  tenantMock: vi.fn(() => ({ tenantId: 'tenant-1' })),
  requestIdMock: vi.fn(() => 'req-123'),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock, clearAuthUserCacheEntry: clearMock }));
vi.mock('@/lib/request-context', () => ({ getRequestId: requestIdMock }));
vi.mock('@/services/auth/auth-service', () => ({ createLogoutResponse: createLogoutMock }));
vi.mock('@/services/audit/audit-service', () => ({ recordAuditEvent: auditMock }));
vi.mock('@/services/tenancy/tenant-context-service', () => ({ resolveTenantContext: tenantMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));

vi.mock('@/services/auth/session-service', () => ({ readSessionToken: readMock, revokeSessionToken: revokeMock }));
vi.mock('@/lib/store', () => ({ usePilingStore: { getState: () => ({ logout: localLogoutMock }) } }));
vi.mock('sonner', () => ({ toast: { error: toastMock } }));
vi.mock('@/lib/client-feedback', () => ({ pushClientFeedback: vi.fn() }));
import { authFetch, logoutClient, probeSession } from '@/lib/api';
afterEach(() => vi.unstubAllGlobals());
import { POST } from '../route';

function req(): NextRequest {
  return new NextRequest('http://localhost/api/auth/logout', { method: 'POST' });
}

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    readMock.mockReset().mockReturnValue(null); revokeMock.mockReset().mockResolvedValue(true);
    clearMock.mockClear(); localLogoutMock.mockClear(); toastMock.mockClear();
    auditMock.mockClear();
    createLogoutMock.mockReset();
    createLogoutMock.mockReturnValue(NextResponse.json({ ok: true }));
  });


  it('F6 review9: failed revocation is 503 without success audit/cookie/cache clearing', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' }, error: null });
    readMock.mockReturnValue('owned-fake-token'); revokeMock.mockResolvedValue(false);
    const response = await POST(req());
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain('Сеанс остаётся активным');
    expect(auditMock).not.toHaveBeenCalled(); expect(createLogoutMock).not.toHaveBeenCalled(); expect(clearMock).not.toHaveBeenCalled();
  });

  it('F6 review9: client keeps session and reports an unsuccessful logout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(NextResponse.json({ error: 'Сеанс остаётся активным' }, { status: 503 })));
    expect(await logoutClient()).toBe(false);
    expect(localLogoutMock).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith('Сеанс остаётся активным');
  });

  it('F6 review9: client keeps session on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    expect(await logoutClient()).toBe(false);
    expect(localLogoutMock).not.toHaveBeenCalled(); expect(toastMock).toHaveBeenCalled();
  });

  it('X2: declining logout with a draft leaves the session intact', async () => {
    const checkDraft = (event: Event) => { (event as CustomEvent).detail.hasDraft = true; };
    window.addEventListener('report-draft-before-logout', checkDraft);
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirm);
    const request = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    vi.stubGlobal('fetch', request);
    try {
      expect(await logoutClient()).toBe(false);
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(request).not.toHaveBeenCalled();
      expect(localLogoutMock).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('report-draft-before-logout', checkDraft);
    }
  });

  it('X2: a draft storage failure blocks logout', async () => {
    const checkDraft = (event: Event) => { (event as CustomEvent).detail.saveFailed = true; };
    window.addEventListener('report-draft-before-logout', checkDraft);
    const request = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    vi.stubGlobal('fetch', request);
    try {
      expect(await logoutClient()).toBe(false);
      expect(request).not.toHaveBeenCalled();
      expect(localLogoutMock).not.toHaveBeenCalled();
    } finally { window.removeEventListener('report-draft-before-logout', checkDraft); }
  });

  it('F6 review9: successful revocation still clears server and client session', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' }, error: null });
    readMock.mockReturnValue('owned-fake-token');
    expect((await POST(req())).status).toBe(200);
    expect(clearMock).toHaveBeenCalledWith('owned-fake-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(NextResponse.json({ ok: true })));
    expect(await logoutClient()).toBe(true); expect(localLogoutMock).toHaveBeenCalledTimes(1);
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

describe('X1: bounded client requests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
    })));
  });
  afterEach(() => vi.useRealTimers());

  it('a hanging session probe becomes unknown after 20 seconds', async () => {
    const pending = probeSession();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await pending).toEqual({ status: 'unknown' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a hanging report request rejects with a readable message', async () => {
    const pending = expect(authFetch('/api/reports/upsert', { method: 'POST', body: '{}' }))
      .rejects.toThrow('Нет связи. Проверьте сеть и повторите');
    await vi.advanceTimersByTimeAsync(20_000);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('file uploads have a longer deadline', async () => {
    const body = new FormData();
    body.append('file', new Blob(['photo']), 'photo.jpg');
    const pending = expect(authFetch('/api/media/upload', { method: 'POST', body }))
      .rejects.toThrow('Нет связи. Проверьте сеть и повторите');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(100_000);
    await pending;
  });

  it('preserves external cancellation and clears its timer', async () => {
    const external = new AbortController();
    const cause = new DOMException('Leaving page', 'AbortError');
    const pending = expect(authFetch('/api/sites', { signal: external.signal })).rejects.toBe(cause);
    external.abort(cause);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });
});
