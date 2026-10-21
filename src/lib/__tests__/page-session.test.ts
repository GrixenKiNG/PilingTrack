/**
 * N1021-H12: поведение `readPageSessionUser` — единственной серверной проверки
 * сессии для раскладок разделов (ADR-0046, инцидент 19.08.2026).
 *
 * Проверяем наблюдаемое, а не внутренние вызовы: когда сессии нет, когда её
 * отозвали/выключили/перевели человека в другую организацию — раскладка
 * получает `null` и уводит на /login; и отдельно — что организация из токена
 * попадает в контекст ДО чтения строки пользователя, иначе строгий RLS не
 * отдаёт строку и получается цикл /admin ↔ /login.
 *
 * Границы замоканы: cookie-хранилище, проверка подписи токена (там же срок
 * жизни и список отзыва) и выборка пользователя. `tokenTenantId` берётся
 * настоящий — от него зависит различие «токен версии 1 ничего не говорит об
 * организации» и «токен версии 2 утверждает организацию».
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookieValue: undefined as string | undefined,
  payload: null as
    | { sub: string; v?: number; sv?: number; tenantId?: string | null }
    | null,
  user: null as {
    role: string;
    isActive: boolean;
    sessionVersion: number;
    tenantId: string | null;
  } | null,
  findUnique: vi.fn(),
  // Тенант, который был в контексте в момент чтения строки пользователя.
  tenantAtRead: undefined as string | null | undefined,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      mocks.cookieValue === undefined ? undefined : { name, value: mocks.cookieValue },
  }),
}));

vi.mock('@/services/auth/session-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/auth/session-service')>();
  return {
    ...actual,
    verifySessionToken: async () => mocks.payload,
  };
});

vi.mock('@/lib/db', () => ({
  db: { user: { findUnique: mocks.findUnique } },
}));

import { getRequestTenantId } from '@/core/security/tenant-context';
import { readPageSessionUser } from '../page-session';

describe('readPageSessionUser', () => {
  beforeEach(() => {
    mocks.cookieValue = 'token';
    mocks.payload = { sub: 'user-1', v: 2, sv: 3, tenantId: 'tenant-a' };
    mocks.user = { role: 'ADMIN', isActive: true, sessionVersion: 3, tenantId: 'tenant-a' };
    mocks.tenantAtRead = undefined;
    mocks.findUnique.mockReset();
    mocks.findUnique.mockImplementation(async () => {
      mocks.tenantAtRead = getRequestTenantId();
      return mocks.user;
    });
  });

  it('сессии нет — null, и в базу не ходим: ни без cookie, ни с истёкшим токеном', async () => {
    mocks.cookieValue = undefined;
    await expect(readPageSessionUser()).resolves.toBeNull();

    // Срок жизни и список отзыва проверяет verifySessionToken (граница).
    mocks.cookieValue = 'token';
    mocks.payload = null;
    await expect(readPageSessionUser()).resolves.toBeNull();

    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('пользователя нет в базе — null', async () => {
    mocks.user = null;

    await expect(readPageSessionUser()).resolves.toBeNull();
  });

  it('активная сессия — возвращает роль и версию сессии', async () => {
    await expect(readPageSessionUser()).resolves.toEqual({
      role: 'ADMIN',
      isActive: true,
      sessionVersion: 3,
    });
  });

  it('организация из токена оказывается в контексте ДО чтения строки пользователя', async () => {
    await readPageSessionUser();

    expect(mocks.tenantAtRead).toBe('tenant-a');
  });

  it('учётную запись выключили после выдачи токена — null', async () => {
    mocks.user = { role: 'ADMIN', isActive: false, sessionVersion: 3, tenantId: 'tenant-a' };

    await expect(readPageSessionUser()).resolves.toBeNull();
  });

  it('версия сессии в токене устарела (сменили пароль или роль) — null', async () => {
    mocks.payload = { sub: 'user-1', v: 2, sv: 2, tenantId: 'tenant-a' };

    await expect(readPageSessionUser()).resolves.toBeNull();
  });

  it('токен утверждает чужую организацию — null', async () => {
    mocks.payload = { sub: 'user-1', v: 2, sv: 3, tenantId: 'tenant-b' };

    await expect(readPageSessionUser()).resolves.toBeNull();
  });

  it('токен версии 1 без организации: номер версии сессии считается нулевым', async () => {
    mocks.payload = { sub: 'user-1', v: 1 };
    mocks.user = { role: 'OPERATOR', isActive: true, sessionVersion: 0, tenantId: 'tenant-a' };

    await expect(readPageSessionUser()).resolves.toEqual({
      role: 'OPERATOR',
      isActive: true,
      sessionVersion: 0,
    });
  });
});
