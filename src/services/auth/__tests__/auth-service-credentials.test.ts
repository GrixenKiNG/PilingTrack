/**
 * Контракт проверки учётных данных: что именно пускает и что не пускает.
 *
 * Файл покрывает не проценты, а места, где ошибка означает вход без пароля.
 * До 18.08.2026 auth-service.ts был покрыт на 14% строк и 5.5% функций —
 * то есть ровно эта логика не была доказана ничем.
 *
 * Ограничение по времени: bcrypt здесь настоящий, 12 раундов. Хешей на файл
 * ровно два и оба считаются один раз в beforeAll, иначе прогон уезжает за
 * стандартный лимит теста.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { hash as bcryptHash } from 'bcryptjs';
import { createHash } from 'node:crypto';

const { checkMock, resetMock } = vi.hoisted(() => ({
  checkMock: vi.fn(),
  resetMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/rate-limiter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limiter')>();
  return { ...actual, rateLimiter: { check: checkMock, reset: resetMock } };
});

const { findUniqueMock, findManyMock, updateMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  findManyMock: vi.fn(),
  updateMock: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/lib/db', () => ({
  db: { user: { findUnique: findUniqueMock, findMany: findManyMock, update: updateMock } },
}));

import {
  authenticateUserByEmailPassword,
  authenticateUserByPin,
  computePinLookup,
} from '../auth-service';

const ALLOWED = { allowed: true, remaining: 4 };
const PASSWORD = 'correct-horse';

let bcryptOfPassword: string;
const sha256OfPassword = createHash('sha256').update(PASSWORD).digest('hex');

function userRow(over: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    email: 'operator@piling.ru',
    password: bcryptOfPassword,
    name: 'Оператор',
    role: 'OPERATOR',
    isActive: true,
    tenantId: 'orion',
    sessionVersion: 1,
    ...over,
  };
}

beforeAll(async () => {
  bcryptOfPassword = await bcryptHash(PASSWORD, 12);
}, 30_000);

beforeEach(() => {
  checkMock.mockReset();
  checkMock.mockResolvedValue(ALLOWED);
  resetMock.mockClear();
  findUniqueMock.mockReset();
  findManyMock.mockReset();
  findManyMock.mockResolvedValue([]);
  updateMock.mockClear();
});

describe('authenticateUserByEmailPassword — кого пускать', () => {
  it('пускает по верному bcrypt-паролю и не переписывает хеш', async () => {
    findUniqueMock.mockResolvedValue(userRow());

    const result = await authenticateUserByEmailPassword('operator@piling.ru', PASSWORD, '10.0.0.1');

    expect(result.user).toMatchObject({ id: 'u1', role: 'OPERATOR', tenantId: 'orion' });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('НЕ отдаёт хеш пароля в сессию', async () => {
    findUniqueMock.mockResolvedValue(userRow());

    const result = await authenticateUserByEmailPassword('operator@piling.ru', PASSWORD, '10.0.0.1');

    // Утечка хеша в сессию означала бы его попадание в JWT и в клиент.
    expect(result.user).not.toHaveProperty('password');
    expect(JSON.stringify(result.user)).not.toContain('$2');
  });

  it('не пускает отключённого пользователя даже с верным паролем', async () => {
    findUniqueMock.mockResolvedValue(userRow({ isActive: false }));

    const result = await authenticateUserByEmailPassword('operator@piling.ru', PASSWORD, '10.0.0.1');

    expect(result.user).toBeNull();
  });

  it('не пускает по неверному паролю и НЕ сбрасывает счётчик попыток', async () => {
    findUniqueMock.mockResolvedValue(userRow());

    const result = await authenticateUserByEmailPassword('operator@piling.ru', 'wrong', '10.0.0.1');

    expect(result.user).toBeNull();
    // Сброс на неудаче обнулял бы защиту от перебора: каждая новая попытка
    // возвращала бы счётчик в исходное состояние.
    expect(resetMock).not.toHaveBeenCalled();
  });

  it('на успехе сбрасывает только счётчик аккаунта, не общий по адресу', async () => {
    findUniqueMock.mockResolvedValue(userRow());

    await authenticateUserByEmailPassword('operator@piling.ru', PASSWORD, '10.0.0.1');

    expect(resetMock).toHaveBeenCalledTimes(1);
    expect(resetMock).toHaveBeenCalledWith('login:operator@piling.ru:10.0.0.1');
  });

  it('ищет по адресу в нижнем регистре — вход не зависит от регистра', async () => {
    findUniqueMock.mockResolvedValue(userRow());

    await authenticateUserByEmailPassword('Operator@Piling.RU', PASSWORD, '10.0.0.1');

    expect(findUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'operator@piling.ru' } }),
    );
  });
});

describe('authenticateUserByEmailPassword — форматы хранимого пароля', () => {
  it('пускает по устаревшему SHA-256 и тут же пересохраняет пароль в bcrypt', async () => {
    findUniqueMock.mockResolvedValue(userRow({ password: sha256OfPassword }));

    const result = await authenticateUserByEmailPassword('operator@piling.ru', PASSWORD, '10.0.0.1');

    expect(result.user).not.toBeNull();
    expect(updateMock).toHaveBeenCalledTimes(1);
    const written = updateMock.mock.calls[0][0].data.password as string;
    expect(written.startsWith('$2')).toBe(true);
  });

  it('НЕ пускает, когда в базе лежит открытый пароль', async () => {
    // Историческая ловушка, названная в комментарии самого сервиса: при
    // неизвестном формате нельзя скатываться к сравнению строк, иначе
    // открытый пароль в базе становится рабочим ключом.
    findUniqueMock.mockResolvedValue(userRow({ password: PASSWORD }));

    const result = await authenticateUserByEmailPassword('operator@piling.ru', PASSWORD, '10.0.0.1');

    expect(result.user).toBeNull();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('НЕ пускает при пустом хеше', async () => {
    findUniqueMock.mockResolvedValue(userRow({ password: '' }));

    const result = await authenticateUserByEmailPassword('operator@piling.ru', '', '10.0.0.1');

    expect(result.user).toBeNull();
  });
});

describe('authenticateUserByPin — вход оператора', () => {
  const BLOCKED = { allowed: false, remaining: 0, retryAfter: 120 };

  function pinRow(over: Record<string, unknown> = {}) {
    return { ...userRow(), pin: '1234', pinLookup: 'lookup-1', ...over };
  }

  it('считает попытки по адресу обратившегося, а не по значению ПИНа', async () => {
    // Счётчик по самому ПИНу был бы бесполезен: злоумышленник перебирает
    // разные ПИНы с одного адреса и не задевает ни один счётчик, зато
    // честный пользователь блокируется за чужие попытки с тем же ПИНом.
    findUniqueMock.mockResolvedValue(null);

    await authenticateUserByPin('1234', '198.51.100.9');

    expect(checkMock).toHaveBeenCalledWith('pin-ip-198.51.100.9', expect.anything());
    const keys = checkMock.mock.calls.map(([key]) => key);
    expect(keys.some((k: string) => k.includes('1234'))).toBe(false);
  });

  it('при исчерпанном счётчике не ходит в базу вовсе', async () => {
    checkMock.mockResolvedValue(BLOCKED);

    const result = await authenticateUserByPin('1234', '198.51.100.9');

    expect(result.rateLimited).toBe(true);
    expect(result.retryAfter).toBe(120);
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('пускает по быстрому пути и сбрасывает счётчик', async () => {
    findUniqueMock.mockResolvedValue(pinRow());

    const result = await authenticateUserByPin('1234', '198.51.100.9');

    expect(result.user).toMatchObject({ id: 'u1', role: 'OPERATOR' });
    expect(resetMock).toHaveBeenCalledWith('pin-ip-198.51.100.9');
    expect(findManyMock).not.toHaveBeenCalled(); // полный перебор не понадобился
  });

  it('НЕ отдаёт ни ПИН, ни хеш пароля в сессию', async () => {
    findUniqueMock.mockResolvedValue(pinRow());

    const result = await authenticateUserByPin('1234', '198.51.100.9');

    expect(result.user).not.toHaveProperty('pin');
    expect(result.user).not.toHaveProperty('pinLookup');
    expect(result.user).not.toHaveProperty('password');
  });

  it('не пускает отключённого пользователя и не срывается в полный перебор ради него', async () => {
    findUniqueMock.mockResolvedValue(pinRow({ isActive: false }));

    const result = await authenticateUserByPin('1234', '198.51.100.9');

    expect(result.user).toBeNull();
    // Перебор ищет только среди активных, так что отключённый не всплывёт и там.
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isActive: true }) }),
    );
  });

  it('не пускает по неверному ПИНу', async () => {
    findUniqueMock.mockResolvedValue(null);
    findManyMock.mockResolvedValue([pinRow({ pin: '9999', pinLookup: null })]);

    const result = await authenticateUserByPin('1234', '198.51.100.9');

    expect(result.user).toBeNull();
    expect(resetMock).not.toHaveBeenCalled();
  });

  it('находит по устаревшему пути и достраивает ключ поиска на будущее', async () => {
    findUniqueMock.mockResolvedValue(null);
    findManyMock.mockResolvedValue([pinRow({ pinLookup: null })]);

    const result = await authenticateUserByPin('1234', '198.51.100.9');

    expect(result.user).toMatchObject({ id: 'u1' });
    const written = updateMock.mock.calls[0][0].data;
    expect(written.pinLookup).toBeTruthy();
    // Открытый ПИН заодно переводится в bcrypt, чтобы не остался в базе как есть.
    expect(String(written.pin).startsWith('$2')).toBe(true);
  });

  it('сбой поиска по индексу не роняет вход — остаётся запасной путь', async () => {
    findUniqueMock.mockRejectedValue(new Error('колонки pinLookup ещё нет'));
    findManyMock.mockResolvedValue([pinRow({ pinLookup: null })]);

    const result = await authenticateUserByPin('1234', '198.51.100.9');

    expect(result.user).toMatchObject({ id: 'u1' });
  });
});

describe('computePinLookup', () => {
  // vi.stubEnv, а не присваивание в process.env: NODE_ENV объявлен только для
  // чтения, и прямое присваивание не проходит проверку типов.
  afterEach(() => { vi.unstubAllEnvs(); });

  it('детерминирован: один и тот же ПИН даёт один и тот же ключ', () => {
    vi.stubEnv('PIN_LOOKUP_SECRET', 'secret-a');
    expect(computePinLookup('1234')).toBe(computePinLookup('1234'));
  });

  it('разные ПИНы дают разные ключи', () => {
    vi.stubEnv('PIN_LOOKUP_SECRET', 'secret-a');
    expect(computePinLookup('1234')).not.toBe(computePinLookup('4321'));
  });

  it('смена секрета меняет ключ — ротация обесценивает старые записи', () => {
    vi.stubEnv('PIN_LOOKUP_SECRET', 'secret-a');
    const before = computePinLookup('1234');
    vi.stubEnv('PIN_LOOKUP_SECRET', 'secret-b');
    expect(computePinLookup('1234')).not.toBe(before);
  });

  it('на проде падает без выделенного секрета', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PIN_LOOKUP_SECRET', '');
    vi.stubEnv('SESSION_SECRET', 'session-only');
    expect(() => computePinLookup('1234')).toThrow(/PIN_LOOKUP_SECRET is required/);
  });

  it('на проде падает, если секрет совпадает с сессионным', () => {
    // Иначе ротация одного ключа молча ломает другой, а компрометация
    // подписи JWT заодно вскрывает поиск по ПИНам.
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PIN_LOOKUP_SECRET', 'same');
    vi.stubEnv('SESSION_SECRET', 'same');
    expect(() => computePinLookup('1234')).toThrow(/must be different/);
  });
});
