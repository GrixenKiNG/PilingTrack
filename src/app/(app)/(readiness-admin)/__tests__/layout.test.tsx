import { beforeEach, describe, expect, it, vi } from 'vitest';

const { verifySessionTokenMock, findUniqueMock, cookiesMock, redirectMock } = vi.hoisted(() => ({
  verifySessionTokenMock: vi.fn(),
  findUniqueMock: vi.fn(),
  cookiesMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
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

import ReadinessAdminLayout from '../layout';

function withUser(role: string, sessionVersion = 1) {
  cookiesMock.mockResolvedValue({ get: () => ({ value: 'valid-token' }) });
  verifySessionTokenMock.mockResolvedValue({ sub: 'user-1', role, sv: sessionVersion });
  findUniqueMock.mockResolvedValue({ role, isActive: true, sessionVersion });
}

describe('ReadinessAdminLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redirectMock.mockImplementation((url: string) => {
      throw Object.assign(new Error(`REDIRECT:${url}`), { digest: `NEXT_REDIRECT;${url}` });
    });
  });

  it.each(['ADMIN', 'DISPATCHER', 'MECHANIC', 'OPERATOR'])(
    'allows %s to render only the isolated readiness route tree',
    async (role) => {
      withUser(role);
      const result = await ReadinessAdminLayout({
        children: 'READINESS' as unknown as React.ReactNode,
      });
      expect(result).toBeTruthy();
    }
  );

  it('redirects ASSISTANT away from readiness admin routes', async () => {
    const role = 'ASSISTANT';
    withUser(role);
    await expect(
      ReadinessAdminLayout({ children: null })
    ).rejects.toThrow('REDIRECT:/operator');
  });

  it('rejects a stale mechanic session', async () => {
    withUser('MECHANIC', 1);
    findUniqueMock.mockResolvedValue({ role: 'MECHANIC', isActive: true, sessionVersion: 2 });
    await expect(
      ReadinessAdminLayout({ children: null })
    ).rejects.toThrow('REDIRECT:/login');
  });
});
