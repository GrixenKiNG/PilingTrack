import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
  compare: vi.fn(),
  hash: vi.fn(),
  check: vi.fn(),
  reset: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock('bcryptjs', () => ({
  hash: mocks.hash,
  compare: mocks.compare,
}));
vi.mock('@/lib/rate-limiter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limiter')>();
  return {...actual, rateLimiter: {check: mocks.check, reset: mocks.reset, refund: vi.fn().mockResolvedValue(undefined)}};
});
vi.mock('@/lib/db', () => ({db: {user: {findUnique: mocks.findUnique}}}));
vi.mock('@/lib/logger', () => ({logger: {info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn()}}));

import {
  authenticateUserByEmailPassword,
  createAuthenticatedResponse,
  createLogoutResponse,
  hashPassword,
  verifyPassword,
} from '../auth-service';
import {SESSION_COOKIE_NAME} from '../session-service';

const user = {id: 'u1', email: 'a@piling.ru', name: 'Тест', role: 'OPERATOR', tenantId: 'orion', sessionVersion: 2};

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', 'z'.repeat(40));
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.check.mockResolvedValue({allowed: true, remaining: 4});
  mocks.reset.mockResolvedValue(undefined);
});

describe('обёртки над bcrypt', () => {
  it('хеширует с 12 раундами и сверяет через compare', async () => {
    mocks.hash.mockResolvedValue('$2b$12$hash');
    mocks.compare.mockResolvedValue(true);
    expect(await hashPassword('secret')).toBe('$2b$12$hash');
    expect(mocks.hash).toHaveBeenCalledWith('secret', 12);
    expect(await verifyPassword('secret', '$2b$12$hash')).toBe(true);
    expect(mocks.compare).toHaveBeenCalledWith('secret', '$2b$12$hash');
  });
});

describe('ответы входа и выхода', () => {
  it('вход кладёт пользователя в тело и защищённую куку сессии', async () => {
    const response = await createAuthenticatedResponse(user, 'req-1');
    expect(await response.json()).toEqual({user});
    const cookie = response.cookies.get(SESSION_COOKIE_NAME);
    expect(cookie).toMatchObject({httpOnly: true, sameSite: 'lax', path: '/'});
    expect(cookie?.value.split('.')).toHaveLength(3);
    expect(response.headers.get('x-request-id')).toBe('req-1');
  });

  it('вход без идентификатора запроса не ставит заголовок', async () => {
    const response = await createAuthenticatedResponse(user);
    expect(response.headers.get('x-request-id')).toBeNull();
  });

  it('выход очищает куку', () => {
    const response = createLogoutResponse('req-2');
    expect(response.cookies.get(SESSION_COOKIE_NAME)).toMatchObject({value: '', maxAge: 0});
    expect(response.headers.get('x-request-id')).toBe('req-2');
    expect(createLogoutResponse().headers.get('x-request-id')).toBeNull();
  });
});

describe('сбой при сверке пароля', () => {
  it('ошибка bcrypt пробрасывается, а счётчики попыток не сбрасываются', async () => {
    mocks.findUnique.mockResolvedValue({...user, password: '$2b$12$hash', isActive: true});
    mocks.compare.mockRejectedValue(new Error('bcrypt exploded'));
    await expect(authenticateUserByEmailPassword('A@piling.ru', 'pw', 'ip-1')).rejects.toThrow('bcrypt exploded');
    expect(mocks.reset).not.toHaveBeenCalled();
  });

  it.each([[0, 111], [1, 222], [2, 333]])('отказывает со сроком, когда не пускает проверка №%i', async (deniedAt, retryAfter) => {
    let call = 0;
    mocks.check.mockImplementation(async () => (call++ === deniedAt
      ? {allowed: false, remaining: 0, retryAfter}
      : {allowed: true, remaining: 1}));
    const result = await authenticateUserByEmailPassword('a@piling.ru', 'pw', 'ip-1');
    expect(result).toEqual({user: null, rateLimited: true, retryAfter});
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
});
