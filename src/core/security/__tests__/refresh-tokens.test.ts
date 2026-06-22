/**
 * Refresh-token family max-lifetime enforcement.
 *
 * REFRESH_TOKEN_FAMILY_TTL_DAYS (90d) caps how long a single login session
 * may live across rotations, INDEPENDENT of the per-token 30d TTL. Without it
 * a stolen-and-rotated token chain could be replayed indefinitely: each
 * rotation issues a fresh 30d token, so the family never ages out.
 *
 * These tests pin: a family older than 90 days is rejected on rotation even
 * when the presented token is itself still within its 30d window, and the
 * whole family is revoked (forces a clean re-login).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  findUniqueMock,
  findManyMock,
  updateManyMock,
  updateMock,
  createMock,
  userFindUniqueMock,
  createSessionTokenMock,
} = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  findManyMock: vi.fn(),
  updateManyMock: vi.fn(),
  updateMock: vi.fn(),
  createMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  createSessionTokenMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    refreshToken: {
      findUnique: findUniqueMock,
      findMany: findManyMock,
      updateMany: updateManyMock,
      update: updateMock,
      create: createMock,
    },
    user: { findUnique: userFindUniqueMock },
  },
}));
vi.mock('@/services/auth/session-service', () => ({
  createSessionToken: createSessionTokenMock,
}));

import { rotateRefreshToken } from '../refresh-tokens';

const DAY = 24 * 60 * 60 * 1000;

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY);
}
function daysAhead(n: number): Date {
  return new Date(Date.now() + n * DAY);
}

describe('rotateRefreshToken — family max-lifetime (90d)', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    findManyMock.mockReset().mockResolvedValue([]); // no concurrent reuse by default
    updateManyMock.mockReset().mockResolvedValue({ count: 1 });
    updateMock.mockReset().mockResolvedValue({});
    createMock.mockReset().mockResolvedValue({});
    userFindUniqueMock.mockReset().mockResolvedValue({
      id: 'u1', email: 'a@b.ru', name: 'A', role: 'OPERATOR', isActive: true, tenantId: 'orion',
    });
    createSessionTokenMock.mockReset().mockResolvedValue('access-NEW');
  });

  it('rejects a family older than 90 days even when the token itself is unexpired', async () => {
    // Token presented is valid in isolation (expires in 20 days, not revoked),
    // but the family was born 91 days ago → must be refused.
    findUniqueMock.mockResolvedValue({
      id: 't-current',
      userId: 'u1',
      token: 'hash',
      family: 'fam-old',
      familyCreatedAt: daysAgo(91),
      expiresAt: daysAhead(20),
      revoked: false,
    });

    await expect(rotateRefreshToken('raw-token')).rejects.toMatchObject({ status: 401 });

    // No new token should be issued for an over-age family.
    expect(createMock).not.toHaveBeenCalled();
  });

  it('revokes the entire family when the max lifetime is exceeded', async () => {
    findUniqueMock.mockResolvedValue({
      id: 't-current',
      userId: 'u1',
      token: 'hash',
      family: 'fam-old',
      familyCreatedAt: daysAgo(100),
      expiresAt: daysAhead(5),
      revoked: false,
    });

    await expect(rotateRefreshToken('raw-token')).rejects.toMatchObject({ status: 401 });

    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { family: 'fam-old' },
        data: expect.objectContaining({ revoked: true }),
      })
    );
  });

  it('allows rotation for a family still within the 90-day window', async () => {
    findUniqueMock.mockResolvedValue({
      id: 't-current',
      userId: 'u1',
      token: 'hash',
      family: 'fam-fresh',
      familyCreatedAt: daysAgo(10),
      expiresAt: daysAhead(20),
      revoked: false,
    });

    const pair = await rotateRefreshToken('raw-token');

    expect(pair.accessToken).toBe('access-NEW');
    expect(createMock).toHaveBeenCalledTimes(1); // new token issued
  });
});
