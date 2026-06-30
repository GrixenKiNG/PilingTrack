/**
 * Admin section layout — sessionVersion regression.
 *
 * verifySessionToken only checks signature + the jti revocation denylist,
 * not whether the role claim is still current. Without a live DB check, a
 * deactivated/downgraded user (sessionVersion bumped via force-logout)
 * could see the admin shell render until the JWT's natural 12h expiry —
 * cosmetic since every real API call underneath already re-checks, but a
 * real gap nonetheless. Pin that the layout now redirects on mismatch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { verifySessionTokenMock, findUniqueMock, cookiesMock, redirectMock } = vi.hoisted(() => ({
  verifySessionTokenMock: vi.fn(),
  findUniqueMock: vi.fn(),
  cookiesMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    // next/navigation's real redirect() throws to halt rendering.
    throw Object.assign(new Error(`REDIRECT:${url}`), { digest: `NEXT_REDIRECT;${url}` });
  }),
}));

vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/headers', () => ({ cookies: cookiesMock }));
vi.mock('@/services/auth/session-service', () => ({
  verifySessionToken: verifySessionTokenMock,
  SESSION_COOKIE_NAME: 'pt-session',
}));
vi.mock('@/lib/db', () => ({ db: { user: { findUnique: findUniqueMock } } }));

import AdminSectionLayout from '../layout';

function withCookie(value: string | undefined) {
  cookiesMock.mockResolvedValue({ get: () => (value ? { value } : undefined) });
}

describe('AdminSectionLayout — sessionVersion check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redirectMock.mockImplementation((url: string) => {
      throw Object.assign(new Error(`REDIRECT:${url}`), { digest: `NEXT_REDIRECT;${url}` });
    });
  });

  it('redirects to /login when sessionVersion no longer matches (revoked)', async () => {
    withCookie('stale-token');
    verifySessionTokenMock.mockResolvedValue({ sub: 'user-1', role: 'ADMIN', sv: 0 });
    findUniqueMock.mockResolvedValue({ role: 'ADMIN', isActive: true, sessionVersion: 1 });

    await expect(AdminSectionLayout({ children: null })).rejects.toThrow('REDIRECT:/login');
  });

  it('redirects to /login when the user was deactivated', async () => {
    withCookie('valid-token');
    verifySessionTokenMock.mockResolvedValue({ sub: 'user-1', role: 'ADMIN', sv: 0 });
    findUniqueMock.mockResolvedValue({ role: 'ADMIN', isActive: false, sessionVersion: 0 });

    await expect(AdminSectionLayout({ children: null })).rejects.toThrow('REDIRECT:/login');
  });

  it('redirects to /operator for a non-admin role even with a fresh sessionVersion', async () => {
    withCookie('valid-token');
    verifySessionTokenMock.mockResolvedValue({ sub: 'user-1', role: 'OPERATOR', sv: 0 });
    findUniqueMock.mockResolvedValue({ role: 'OPERATOR', isActive: true, sessionVersion: 0 });

    await expect(AdminSectionLayout({ children: null })).rejects.toThrow('REDIRECT:/operator');
  });

  it('renders children when role and sessionVersion both check out', async () => {
    withCookie('valid-token');
    verifySessionTokenMock.mockResolvedValue({ sub: 'user-1', role: 'ADMIN', sv: 1 });
    findUniqueMock.mockResolvedValue({ role: 'ADMIN', isActive: true, sessionVersion: 1 });

    const result = await AdminSectionLayout({ children: 'CONTENT' as unknown as React.ReactNode });
    expect(result).toBeTruthy();
  });
});
