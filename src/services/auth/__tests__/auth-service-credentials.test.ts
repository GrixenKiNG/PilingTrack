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

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
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

  it('на неизвестном адресе тратит время на bcrypt, как на известном', async () => {
    // Без этого ответ «нет такого адреса» приходил мгновенно, а «неверный
    // пароль» — через ~250 мс: по секундомеру перебирались все e-mail.
    findUniqueMock.mockResolvedValue(null);

    const startedAt = performance.now();
    const result = await authenticateUserByEmailPassword('nobody@piling.ru', PASSWORD, '10.0.0.1');

    expect(result.user).toBeNull();
    expect(performance.now() - startedAt).toBeGreaterThan(50);
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
