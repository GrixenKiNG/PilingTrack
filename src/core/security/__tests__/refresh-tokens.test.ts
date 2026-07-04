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

describe('rotateRefreshToken — concurrent rotation of the SAME token (audit finding #2)', () => {
  // Reproduces the TOCTOU: two concurrent requests present the identical
  // raw refresh token. Both read the same non-revoked row (findUnique is
  // outside any lock), both pass every check, and — before this fix — both
  // reach an unconditional `update` that just sets revoked=true regardless
  // of current state. Neither request can tell it "lost a race," so both
  // proceed to mint a new child token from the same parent: two valid
  // sessions from what should be a single-use rotation, and the reuse
  // detector (which only looks for OTHER token hashes in the family) never
  // sees it because both requests present the SAME hash.
  const baseToken = {
    id: 't-current',
    userId: 'u1',
    token: 'hash',
    family: 'fam-fresh',
    familyCreatedAt: daysAgo(10),
    expiresAt: daysAhead(20),
    revoked: false,
  };

  beforeEach(() => {
    findUniqueMock.mockReset().mockResolvedValue(baseToken);
    findManyMock.mockReset().mockResolvedValue([]); // no sibling-token reuse
    createMock.mockReset().mockResolvedValue({});
    updateMock.mockReset().mockResolvedValue({});
    userFindUniqueMock.mockReset().mockResolvedValue({
      id: 'u1', email: 'a@b.ru', name: 'A', role: 'OPERATOR', isActive: true, tenantId: 'orion',
    });
    createSessionTokenMock.mockReset().mockResolvedValue('access-NEW');
  });

  it('the loser of the atomic revoke race is treated as reuse — 401, family revoked, no new token', async () => {
    // The atomic claim (updateMany where id + revoked:false) returns
    // count:0 when a concurrent request already flipped revoked=true first.
    updateManyMock.mockReset().mockImplementation(async (args: { where: Record<string, unknown> }) => {
      if (args.where.id === baseToken.id && args.where.revoked === false) {
        return { count: 0 }; // lost the race — someone else revoked it first
      }
      return { count: 1 }; // the subsequent family-revoke call
    });

    await expect(rotateRefreshToken('raw-token')).rejects.toMatchObject({ status: 401 });

    // Must not mint a second child token from the same already-rotated parent.
    expect(createMock).not.toHaveBeenCalled();
    // Must revoke the whole family, same response as the sibling-reuse path.
    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { family: baseToken.family },
        data: expect.objectContaining({ revoked: true, revokedReason: expect.stringMatching(/reuse/i) }),
      })
    );
  });

  it('the winner of the atomic revoke race proceeds normally', async () => {
    updateManyMock.mockReset().mockImplementation(async (args: { where: Record<string, unknown> }) => {
      if (args.where.id === baseToken.id && args.where.revoked === false) {
        return { count: 1 }; // won the race — this request revoked it
      }
      return { count: 1 };
    });

    const pair = await rotateRefreshToken('raw-token');

    expect(pair.accessToken).toBe('access-NEW');
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('the per-token revoke uses a conditional updateMany, not an unconditional update', async () => {
    // Pins the actual mechanism of the fix: an unconditional `update` can
    // never detect a lost race (it always "succeeds"), so the revoke step
    // itself must be the atomic updateMany+count check, not a plain update.
    updateManyMock.mockReset().mockResolvedValue({ count: 1 });

    await rotateRefreshToken('raw-token');

    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: baseToken.id, revoked: false } })
    );
  });
});
