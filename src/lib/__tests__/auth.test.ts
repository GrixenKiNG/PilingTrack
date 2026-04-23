import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  readSessionToken: vi.fn(),
  verifySessionToken: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock('@/services/auth/session-service', () => ({
  readSessionToken: mocks.readSessionToken,
  verifySessionToken: mocks.verifySessionToken,
}));

vi.mock('@/lib/db', () => ({
  db: {
    user: {
      findUnique: mocks.findUnique,
    },
  },
}));

function createRequest() {
  return new NextRequest('http://localhost/api/test', {
    headers: {
      cookie: 'pt-session=test-token',
    },
  });
}

describe('requireAuth', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.readSessionToken.mockReturnValue('test-token');
  });

  it('caches the authenticated user for repeated requests with the same session token', async () => {
    mocks.verifySessionToken.mockResolvedValue({
      sub: 'user-1',
      email: 'operator@piling.ru',
      name: 'Operator',
      role: 'OPERATOR',
      type: 'session',
      v: 1,
    });
    mocks.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'operator@piling.ru',
      name: 'Operator',
      role: 'OPERATOR',
      phone: '+70000000000',
      isActive: true,
      tenantId: null,
    });

    const { requireAuth } = await import('../auth');

    const first = await requireAuth(createRequest());
    const second = await requireAuth(createRequest());

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(first.user).toEqual(second.user);
    expect(mocks.verifySessionToken).toHaveBeenCalledTimes(1);
    expect(mocks.findUnique).toHaveBeenCalledTimes(1);
  });

  it('returns 401 when the session token is invalid', async () => {
    mocks.verifySessionToken.mockResolvedValue(null);

    const { requireAuth } = await import('../auth');
    const result = await requireAuth(createRequest());

    expect(result.user).toBeNull();
    expect(result.error?.status).toBe(401);
    const body = await result.error!.json();
    expect(body).toMatchObject({
      error: 'Session is invalid',
    });
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
});
