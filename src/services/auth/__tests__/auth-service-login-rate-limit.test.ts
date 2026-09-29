/**
 * Email-login rate limiting — dual-bucket contract (audit A-2 / July M3).
 *
 * The old scheme keyed the bucket by email alone:
 *   - an attacker who knows a victim's email could lock the victim out
 *     (5 wrong passwords → 30 min account-wide block, from anywhere);
 *   - rotating emails gave the attacker unlimited total attempts from one IP.
 *
 * The contract now: per-(account+IP) bucket AND per-IP bucket. A block on
 * either denies the attempt; success resets only the account+IP bucket.
 *
 * 28.09.2026 владелец выбрал блокировку аккаунта (вариант «б», Codex out13 №4):
 * с каждого нового IP злоумышленник получал ещё 5 попыток на тот же аккаунт.
 * Теперь есть и общий счётчик по аккаунту со всех адресов — 10 попыток за
 * 15 минут, затем вход в аккаунт закрыт на 15 минут. Риск, что чужой нарочно
 * заблокирует машиниста, владелец принял осознанно.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { checkMock, resetMock } = vi.hoisted(() => ({
  checkMock: vi.fn(),
  resetMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/rate-limiter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limiter')>();
  return {
    ...actual,
    rateLimiter: { check: checkMock, reset: resetMock },
  };
});

const { findUniqueMock } = vi.hoisted(() => ({ findUniqueMock: vi.fn() }));
vi.mock('@/lib/db', () => ({
  db: { user: { findUnique: findUniqueMock, update: vi.fn() } },
}));

import { authenticateUserByEmailPassword } from '../auth-service';

const ALLOWED = { allowed: true, remaining: 4 };
const BLOCKED = { allowed: false, remaining: 0, retryAfter: 60 };

describe('authenticateUserByEmailPassword rate limiting', () => {
  beforeEach(() => {
    checkMock.mockReset();
    resetMock.mockClear();
    findUniqueMock.mockReset();
    findUniqueMock.mockResolvedValue(null); // unknown user is fine for these tests
  });

  it('checks BOTH the per-IP bucket and the account+IP bucket', async () => {
    checkMock.mockResolvedValue(ALLOWED);

    await authenticateUserByEmailPassword('victim@x.ru', 'wrong-pass', '203.0.113.7');

    const keys = checkMock.mock.calls.map(([key]) => key);
    expect(keys).toContain('login-ip:203.0.113.7');
    expect(keys).toContain('login:victim@x.ru:203.0.113.7');
  });

  it('denies when the per-IP bucket is exhausted even for a fresh email', async () => {
    checkMock.mockImplementation(async (key: string) =>
      key.startsWith('login-ip:') ? BLOCKED : ALLOWED,
    );

    const result = await authenticateUserByEmailPassword('fresh-email@x.ru', 'x', '203.0.113.7');

    expect(result.rateLimited).toBe(true);
    // The email-rotation bypass: a fresh email must NOT grant fresh attempts.
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it('считает попытки и по аккаунту со всех адресов, с лимитом 10 за 15 минут и блоком 15 минут', async () => {
    checkMock.mockResolvedValue(ALLOWED);

    await authenticateUserByEmailPassword('Victim@X.ru', 'x', 'attacker-ip');

    const call = checkMock.mock.calls.find(([key]) => key === 'login-acct:victim@x.ru');
    expect(call).toBeDefined();
    expect(call?.[1]).toMatchObject({ maxAttempts: 10, windowMs: 15 * 60 * 1000, blockDurationMs: 15 * 60 * 1000 });
  });

  it('заблокированный аккаунт не пускает с нового адреса и не ищет пользователя', async () => {
    checkMock.mockImplementation(async (key: string) =>
      key.startsWith('login-acct:') ? BLOCKED : ALLOWED,
    );

    const result = await authenticateUserByEmailPassword('victim@x.ru', 'right-or-wrong', 'fresh-ip');

    expect(result).toMatchObject({ user: null, rateLimited: true, retryAfter: 60 });
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it('несуществующая почта считается и блокируется так же — по блоку не узнать, есть ли аккаунт', async () => {
    checkMock.mockResolvedValue(ALLOWED);
    findUniqueMock.mockResolvedValue(null);

    await authenticateUserByEmailPassword('nobody@x.ru', 'x', '203.0.113.7');

    expect(checkMock.mock.calls.map(([key]) => key)).toContain('login-acct:nobody@x.ru');
  });
});
