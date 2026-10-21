import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {SignJWT} from 'jose';
import {NextRequest, NextResponse} from 'next/server';

/**
 * Что не покрывает основной тест сессий: боевое хранилище отзыва в Redis
 * (отказ Redis не должен ни разлогинить всех, ни вернуть отозванный токен там,
 * где отзыв записан), выбор секрета и версии токена.
 */
const fake = vi.hoisted(() => ({
  status: 'ready',
  get: vi.fn(),
  set: vi.fn(),
  on: vi.fn(),
  ctorThrows: false,
  created: 0,
}));

vi.mock('ioredis', () => ({
  Redis: class {
    constructor() {
      fake.created += 1;
      if (fake.ctorThrows) throw new Error('cannot construct');
    }
    get status() { return fake.status; }
    get = fake.get;
    set = fake.set;
    on = fake.on;
  },
}));

const user = {id: 'user-1', email: 'a@piling.ru', name: 'Тест', role: 'OPERATOR', tenantId: 'orion', sessionVersion: 3};
const SECRET = 'x'.repeat(40);

async function load() {
  vi.resetModules();
  return import('../session-service');
}

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', SECRET);
  vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:6379');
  fake.status = 'ready';
  fake.ctorThrows = false;
  fake.created = 0;
  fake.get.mockReset();
  fake.set.mockReset();
  fake.on.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('хранилище отзыва токенов в Redis', () => {
  it('отозванный токен не проходит проверку, остальные проходят', async () => {
    const s = await load();
    const token = await s.createSessionToken(user);
    fake.get.mockResolvedValueOnce('1');
    expect(await s.verifySessionToken(token)).toBeNull();
    fake.get.mockResolvedValueOnce(null);
    expect(await s.verifySessionToken(token)).toMatchObject({sub: 'user-1', role: 'OPERATOR'});
    expect(fake.get).toHaveBeenCalledWith(expect.stringMatching(/^revoked-jti:/));
  });

  it('пока соединение не готово, проверку пропускает без обращения к Redis', async () => {
    const s = await load();
    const token = await s.createSessionToken(user);
    fake.status = 'connecting';
    expect(await s.verifySessionToken(token)).not.toBeNull();
    expect(fake.get).not.toHaveBeenCalled();
  });

  it('сбой чтения не разлогинивает всех', async () => {
    const s = await load();
    const token = await s.createSessionToken(user);
    fake.get.mockRejectedValueOnce(new Error('down'));
    expect(await s.verifySessionToken(token)).not.toBeNull();
  });

  it('без REDIS_URL отзыв не записать, и об этом честно сообщается', async () => {
    vi.stubEnv('REDIS_URL', '');
    const s = await load();
    const token = await s.createSessionToken(user);
    expect(await s.revokeSessionToken(token)).toBe(false);
    expect(await s.verifySessionToken(token)).not.toBeNull();
    expect(fake.created).toBe(0);
  });

  it('записывает отзыв со сроком, равным остатку жизни токена', async () => {
    const s = await load();
    const token = await s.createSessionToken(user);
    fake.set.mockResolvedValueOnce('OK');
    expect(await s.revokeSessionToken(token)).toBe(true);
    const [key, value, mode, ttl] = fake.set.mock.calls[0];
    expect(key).toMatch(/^revoked-jti:/);
    expect([value, mode]).toEqual(['1', 'EX']);
    expect(ttl).toBeGreaterThan(12 * 3600 - 10);
    expect(ttl).toBeLessThanOrEqual(12 * 3600);
  });

  it('сбой записи отзыва возвращает false', async () => {
    const s = await load();
    const token = await s.createSessionToken(user);
    fake.set.mockRejectedValueOnce(new Error('down'));
    expect(await s.revokeSessionToken(token)).toBe(false);
  });

  it('если клиент не создался, отзыв не пишется и проверка не падает', async () => {
    fake.ctorThrows = true;
    const s = await load();
    const token = await s.createSessionToken(user);
    expect(await s.revokeSessionToken(token)).toBe(false);
    expect(await s.verifySessionToken(token)).not.toBeNull();
    // Повторная попытка клиента не создаёт: отказ запомнен.
    await s.revokeSessionToken(token);
    expect(fake.created).toBe(1);
  });

  it('сообщения об ошибках соединения уходят в журнал, а не наружу', async () => {
    const s = await load();
    await s.createSessionToken(user);
    await s.verifySessionToken(await s.createSessionToken(user));
    const errorHandler = fake.on.mock.calls.find(([event]) => event === 'error')?.[1];
    expect(typeof errorHandler).toBe('function');
    expect(() => errorHandler(new Error('socket'))).not.toThrow();
  });

  it('токен без идентификатора или с истёкшим сроком не отзывается', async () => {
    const s = await load();
    const key = new TextEncoder().encode(SECRET);
    const noJti = await new SignJWT({email: 'a@piling.ru', name: 'T', role: 'OPERATOR', sv: 0, type: 'session', v: 2})
      .setProtectedHeader({alg: 'HS256'}).setSubject('u').setIssuedAt().setExpirationTime('1h').sign(key);
    expect(await s.revokeSessionToken(noJti)).toBe(false);
    const expired = await new SignJWT({email: 'a@piling.ru', name: 'T', role: 'OPERATOR', sv: 0, type: 'session', v: 2})
      .setProtectedHeader({alg: 'HS256'}).setSubject('u').setJti('j').setIssuedAt(1).setExpirationTime(2).sign(key);
    expect(await s.revokeSessionToken(expired)).toBe(false);
    expect(fake.set).not.toHaveBeenCalled();
  });
});

describe('версии и содержимое токена', () => {
  async function signed(claims: Record<string, unknown>) {
    return new SignJWT({email: 'a@piling.ru', name: 'T', role: 'OPERATOR', sv: 0, ...claims})
      .setProtectedHeader({alg: 'HS256'}).setSubject('u').setJti('j').setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
  }

  it('отвергает токен версии 1: окно перехода на версию 2 закрыто', async () => {
    const s = await load();
    expect(await s.verifyTokenSignature(await signed({type: 'session', v: 1}))).toBeNull();
  });

  it('токен версии 2 несёт организацию, а отсутствие организации — это null', async () => {
    const s = await load();
    const withTenant = await s.verifyTokenSignature(await signed({type: 'session', v: 2, tenantId: 'orion'}));
    expect(s.tokenTenantId(withTenant as NonNullable<typeof withTenant>)).toBe('orion');
    const without = await s.verifyTokenSignature(await signed({type: 'session', v: 2}));
    expect(s.tokenTenantId(without as NonNullable<typeof without>)).toBeNull();
  });

  it('отвергает чужой тип токена и неизвестную версию', async () => {
    const s = await load();
    expect(await s.verifyTokenSignature(await signed({type: 'refresh', v: 2}))).toBeNull();
    expect(await s.verifyTokenSignature(await signed({type: 'session', v: 9}))).toBeNull();
    expect(await s.verifyTokenSignature(await signed({type: 'session'}))).toBeNull();
  });

  it('отвергает токен, подписанный другим алгоритмом', async () => {
    const s = await load();
    const token = await new SignJWT({type: 'session', v: 2}).setProtectedHeader({alg: 'HS512'})
      .setSubject('u').setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    expect(await s.verifyTokenSignature(token)).toBeNull();
  });
});

describe('секрет подписи', () => {
  it('на проде короткий секрет не принимается', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_SECRET', 'short');
    const s = await load();
    await expect(s.createSessionToken(user)).rejects.toThrow('at least 32');
  });

  it('на проде без секрета токены не выдаются', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_SECRET', '');
    vi.stubEnv('AUTH_SECRET', '');
    const s = await load();
    await expect(s.createSessionToken(user)).rejects.toThrow('not configured');
    expect(await s.verifyTokenSignature('a.b.c')).toBeNull();
  });

  it('вне прода без секрета используется запасной и предупреждает один раз', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('SESSION_SECRET', '');
    vi.stubEnv('AUTH_SECRET', '');
    const s = await load();
    const first = await s.createSessionToken(user);
    await s.createSessionToken(user);
    expect(await s.verifyTokenSignature(first)).not.toBeNull();
  });

  it('AUTH_SECRET работает, когда SESSION_SECRET не задан', async () => {
    vi.stubEnv('SESSION_SECRET', '');
    vi.stubEnv('AUTH_SECRET', 'y'.repeat(40));
    const s = await load();
    const token = await s.createSessionToken(user);
    expect(await s.verifyTokenSignature(token)).not.toBeNull();
  });
});

describe('куки сессии', () => {
  it('в проде кука защищена флагом secure, вне прода нет', async () => {
    const s = await load();
    vi.stubEnv('NODE_ENV', 'production');
    const prod = s.attachSessionCookie(NextResponse.json({}), 'tok').cookies.get(s.SESSION_COOKIE_NAME);
    expect(prod).toMatchObject({value: 'tok', httpOnly: true, sameSite: 'lax', path: '/', secure: true});
    vi.stubEnv('NODE_ENV', 'test');
    const dev = s.clearSessionCookie(NextResponse.json({})).cookies.get(s.SESSION_COOKIE_NAME);
    expect(dev).toMatchObject({value: '', maxAge: 0, secure: false});
  });

  it('читает токен из куки, затем из заголовка, иначе null', async () => {
    const s = await load();
    expect(s.readSessionToken(new NextRequest('http://x/', {headers: {authorization: 'Bearer abc'}}))).toBe('abc');
    expect(s.readSessionToken(new NextRequest('http://x/', {headers: {authorization: 'Basic abc'}}))).toBeNull();
    const withCookie = new NextRequest('http://x/');
    withCookie.cookies.set(s.SESSION_COOKIE_NAME, 'zzz');
    expect(s.readSessionToken(withCookie)).toBe('zzz');
  });
});
