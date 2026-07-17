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

  it('scopes the account bucket to the caller IP — a stranger cannot lock the victim out globally', async () => {
    checkMock.mockResolvedValue(ALLOWED);

    await authenticateUserByEmailPassword('victim@x.ru', 'x', 'attacker-ip');

    const keys = checkMock.mock.calls.map(([key]) => key);
    expect(keys).toContain('login:victim@x.ru:attacker-ip');
    // No bare-email bucket: blocking must not follow the victim to their own IP.
    expect(keys).not.toContain('victim@x.ru');
  });
});
