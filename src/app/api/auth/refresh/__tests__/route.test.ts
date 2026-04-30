/**
 * /api/auth/refresh — behavioural tests.
 *
 * Refresh-token rotation is in the security hot path: a regression here
 * lets an attacker keep a stolen token alive forever. Pin:
 *   - 400 on invalid body
 *   - 200 with new token pair on success, sets pt-refresh httpOnly cookie
 *   - DELETE revokes and clears the cookie even if no token cookie present
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { rotateMock, attachCookieMock, revokeMock } = vi.hoisted(() => ({
  rotateMock: vi.fn(),
  attachCookieMock: vi.fn(),
  revokeMock: vi.fn(),
}));

vi.mock('@/core/security/refresh-tokens', () => ({
  rotateRefreshToken: rotateMock,
  revokeRefreshToken: revokeMock,
}));
vi.mock('@/services/auth/session-service', () => ({ attachSessionCookie: attachCookieMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));

import { POST, DELETE } from '../route';

function jsonReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/auth/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/refresh', () => {
  beforeEach(() => {
    rotateMock.mockReset();
    attachCookieMock.mockReset();
  });

  it('rejects body without refreshToken with 400', async () => {
    const res = await POST(jsonReq({}));
    expect(res.status).toBe(400);
    expect(rotateMock).not.toHaveBeenCalled();
  });

  it('rejects empty refreshToken with 400', async () => {
    const res = await POST(jsonReq({ refreshToken: '' }));
    expect(res.status).toBe(400);
  });

  it('returns rotated token pair and sets pt-refresh cookie on success', async () => {
    rotateMock.mockResolvedValue({
      accessToken: 'access-NEW',
      refreshToken: 'refresh-NEW',
      expiresAt: '2030-01-01T00:00:00Z',
    });

    const res = await POST(jsonReq({ refreshToken: 'refresh-OLD' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      accessToken: 'access-NEW',
      refreshToken: 'refresh-NEW',
      expiresAt: '2030-01-01T00:00:00Z',
    });

    // Old token rotated, session cookie attached, refresh cookie set on
    // the narrow path /api/auth/refresh (not /).
    expect(rotateMock).toHaveBeenCalledWith('refresh-OLD', null, null);
    expect(attachCookieMock).toHaveBeenCalledWith(expect.anything(), 'access-NEW');
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toContain('pt-refresh=refresh-NEW');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Path=/api/auth/refresh');
  });

  it('forwards x-forwarded-for and user-agent into rotateRefreshToken', async () => {
    rotateMock.mockResolvedValue({
      accessToken: 'a', refreshToken: 'r', expiresAt: '2030-01-01T00:00:00Z',
    });

    const r = new NextRequest('http://localhost/api/auth/refresh', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.1',
        'user-agent': 'PilingTrack-Test/1.0',
      },
      body: JSON.stringify({ refreshToken: 'r1' }),
    });
    await POST(r);
    expect(rotateMock).toHaveBeenCalledWith('r1', '203.0.113.1', 'PilingTrack-Test/1.0');
  });
});

describe('DELETE /api/auth/refresh', () => {
  beforeEach(() => {
    revokeMock.mockReset();
  });

  it('revokes the refresh token from cookie and clears pt-refresh', async () => {
    // NextRequest in this test env doesn't auto-parse the cookie: header,
    // so we set the cookie via the Cookies API directly.
    const r = new NextRequest('http://localhost/api/auth/refresh', { method: 'DELETE' });
    r.cookies.set('pt-refresh', 'refresh-OLD');
    const res = await DELETE(r);
    expect(res.status).toBe(200);
    expect(revokeMock).toHaveBeenCalledWith('refresh-OLD');
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toContain('pt-refresh=');
    expect(setCookie).toContain('Max-Age=0');
  });

  it('still returns 200 when no pt-refresh cookie is present (idempotent logout)', async () => {
    const r = new NextRequest('http://localhost/api/auth/refresh', { method: 'DELETE' });
    const res = await DELETE(r);
    expect(res.status).toBe(200);
    expect(revokeMock).not.toHaveBeenCalled();
  });
});
