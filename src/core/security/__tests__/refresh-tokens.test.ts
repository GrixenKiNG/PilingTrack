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
  deleteManyMock,
  userFindUniqueMock,
  createSessionTokenMock,
} = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  findManyMock: vi.fn(),
  updateManyMock: vi.fn(),
  updateMock: vi.fn(),
  createMock: vi.fn(),
  deleteManyMock: vi.fn(),
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
      deleteMany: deleteManyMock,
    },
    user: { findUnique: userFindUniqueMock },
  },
}));
vi.mock('@/services/auth/session-service', () => ({
  createSessionToken: createSessionTokenMock,
}));

import {
  rotateRefreshToken,
  createRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  revokeTokenFamily,
  cleanupExpiredRefreshTokens,
  getUserActiveSessions,
} from '../refresh-tokens';

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

/**
 * Выдача, отзыв и перечисление сессий.
 *
 * До 18.08.2026 файл покрывал только предельный срок жизни семьи и гонку
 * отзыва: 52.6% строк и 27.3% функций. Ниже закрыты остальные функции, и
 * прежде всего то, что важнее процентов, — сырой токен нигде не оседает.
 */

const SESSION_USER = {
  id: 'u1', email: 'op@piling.ru', name: 'Оператор',
  role: 'OPERATOR', tenantId: 'orion', sessionVersion: 1,
};

function sha256(value: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- узкий помощник теста
  return require('node:crypto').createHash('sha256').update(value).digest('hex');
}

describe('createRefreshToken — выдача', () => {
  beforeEach(() => {
    createMock.mockReset().mockResolvedValue({});
    createSessionTokenMock.mockReset().mockResolvedValue('access-jwt');
  });

  it('в базу кладётся ХЕШ, а не сам токен', async () => {
    // Главное свойство файла: чтения базы недостаточно для входа. Если бы
    // хранился сырой токен, дамп базы означал бы захват любой сессии.
    const pair = await createRefreshToken(SESSION_USER);

    const stored = createMock.mock.calls[0][0].data.token as string;
    expect(stored).not.toBe(pair.refreshToken);
    expect(stored).toBe(sha256(pair.refreshToken));
    expect(stored).toMatch(/^[a-f0-9]{64}$/);
  });

  it('каждая выдача — новый токен и новая семья', async () => {
    const first = await createRefreshToken(SESSION_USER);
    const second = await createRefreshToken(SESSION_USER);

    expect(first.refreshToken).not.toBe(second.refreshToken);
    const families = createMock.mock.calls.map((c) => c[0].data.family);
    expect(families[0]).not.toBe(families[1]);
  });

  it('срок жизни токена — 30 дней', async () => {
    const pair = await createRefreshToken(SESSION_USER);
    const days = (pair.expiresAt.getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it('запоминает адрес и клиент, пустые значения пишет как null', async () => {
    await createRefreshToken(SESSION_USER, '10.0.0.5', 'Chrome');
    expect(createMock.mock.calls[0][0].data).toMatchObject({
      ipAddress: '10.0.0.5', userAgent: 'Chrome',
    });

    createMock.mockClear();
    await createRefreshToken(SESSION_USER);
    expect(createMock.mock.calls[0][0].data).toMatchObject({
      ipAddress: null, userAgent: null,
    });
  });
});

describe('отзыв токенов', () => {
  beforeEach(() => { updateManyMock.mockReset().mockResolvedValue({ count: 1 }); });

  it('одиночный отзыв ищет по хешу, а не по сырому токену', async () => {
    // Поиск по сырому значению не нашёл бы ничего, и выход из системы молча
    // не сработал бы — токен остался бы действующим.
    await revokeRefreshToken('raw-token-value');

    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { token: sha256('raw-token-value'), revoked: false },
      }),
    );
  });

  it('отзыв всех токенов ограничен пользователем и не трогает уже отозванные', async () => {
    await revokeAllUserTokens('u1', 'Смена пароля');

    const call = updateManyMock.mock.calls[0][0];
    expect(call.where).toEqual({ userId: 'u1', revoked: false });
    expect(call.data.revokedReason).toBe('Смена пароля');
  });

  it('отзыв семьи берёт её целиком, включая уже отозванные', async () => {
    // При подозрении на компрометацию условие revoked:false оставило бы
    // часть цепочки нетронутой.
    await revokeTokenFamily('fam-1', 'Повторное использование');

    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { family: 'fam-1' } }),
    );
  });
});

describe('уборка и список сессий', () => {
  it('уборка сносит просроченные и давно отозванные, возвращая количество', async () => {
    deleteManyMock.mockReset().mockResolvedValue({ count: 7 });

    const removed = await cleanupExpiredRefreshTokens();

    expect(removed).toBe(7);
    const where = deleteManyMock.mock.calls[0][0].where;
    // Действующие токены под условие не попадают: только истёкшие ИЛИ
    // отозванные больше недели назад.
    expect(where.OR).toHaveLength(2);
    expect(where.OR[0]).toHaveProperty('expiresAt.lt');
    expect(where.OR[1]).toMatchObject({ revoked: true });
  });

  it('список сессий не отдаёт хеш токена наружу', async () => {
    findManyMock.mockReset().mockResolvedValue([{
      id: 't1', family: 'fam-1', expiresAt: daysAhead(10), createdAt: daysAgo(1),
      lastUsedAt: daysAgo(0), ipAddress: '10.0.0.5', userAgent: 'Chrome',
    }]);

    const sessions = await getUserActiveSessions('u1');

    expect(findManyMock.mock.calls[0][0].select).not.toHaveProperty('token');
    expect(sessions[0]).not.toHaveProperty('token');
    expect(sessions[0].isCurrentSession).toBe(false);
  });

  it('список сессий берёт только действующие', async () => {
    findManyMock.mockReset().mockResolvedValue([]);

    await getUserActiveSessions('u1');

    expect(findManyMock.mock.calls[0][0].where).toMatchObject({
      userId: 'u1', revoked: false,
    });
    expect(findManyMock.mock.calls[0][0].where.expiresAt).toHaveProperty('gt');
  });
});
