/**
 * Роль опознания — переключение на время одной транзакции.
 *
 * Проверяется то, что нельзя увидеть на глаз: без переменной окружения
 * лишней транзакции не заводится (это путь локальной разработки и CI), с
 * переменной — переключение идёт первым оператором внутри транзакции, а
 * недопустимое имя роли отвергается до того, как попадёт в SQL.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const calls: string[] = [];

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  executeRawUnsafe: vi.fn(),
}));

vi.mock('@/lib/db', () => {
  const tx = {
    user: { findUnique: mocks.findUnique },
    deviceKey: { findUnique: vi.fn() },
    $executeRawUnsafe: mocks.executeRawUnsafe,
  };
  return {
    db: {
      user: { findUnique: mocks.findUnique },
      deviceKey: { findUnique: vi.fn() },
      $transaction: async (work: (t: typeof tx) => Promise<unknown>) => {
        calls.push('BEGIN');
        const result = await work(tx);
        calls.push('COMMIT');
        return result;
      },
    },
  };
});

import { withIdentityRole } from '../identity-role';

describe('withIdentityRole', () => {
  beforeEach(() => {
    calls.length = 0;
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({ id: 'u1' });
    mocks.executeRawUnsafe.mockImplementation((sql: string) => {
      calls.push(sql);
      return Promise.resolve(0);
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('без DB_IDENTITY_ROLE транзакции не заводит', async () => {
    vi.stubEnv('DB_IDENTITY_ROLE', '');

    const found = await withIdentityRole((client) => client.user.findUnique({ where: { id: 'u1' } }));

    expect(found).toEqual({ id: 'u1' });
    expect(calls).toEqual([]);
  });

  it('с ролью переключается первым оператором и возвращает результат', async () => {
    vi.stubEnv('DB_IDENTITY_ROLE', 'pilingtrack_identity');

    const found = await withIdentityRole((client) => client.user.findUnique({ where: { id: 'u1' } }));

    expect(found).toEqual({ id: 'u1' });
    // Переключение обязано быть внутри транзакции и до самого запроса:
    // SET LOCAL действует до конца транзакции, снаружи он бессмыслен.
    expect(calls).toEqual(['BEGIN', 'SET LOCAL ROLE "pilingtrack_identity"', 'COMMIT']);
  });

  it.each([
    ['точка с запятой', 'app"; DROP TABLE "User'],
    ['пробел', 'my role'],
    ['заглавные', 'Pilingtrack'],
    ['дефис', 'pilingtrack-identity'],
  ])('недопустимое имя роли (%s) отвергается до похода в базу', async (_label, role) => {
    vi.stubEnv('DB_IDENTITY_ROLE', role);

    await expect(
      withIdentityRole((client) => client.user.findUnique({ where: { id: 'u1' } })),
    ).rejects.toThrow('недопустимое имя роли');

    expect(calls).toEqual([]);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
});
