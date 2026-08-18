import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Порядок вызовов записываем в общий журнал: главное свойство перевода на
// токены — организация попадает в контекст ДО чтения строки пользователя, а
// не после. Проверить это можно только по очерёдности.
const mocks = vi.hoisted(() => ({
  readSessionToken: vi.fn(),
  verifySessionToken: vi.fn(),
  findUnique: vi.fn(),
  setRequestTenantId: vi.fn(),
  calls: [] as string[],
}));

vi.mock('@/services/auth/session-service', () => ({
  readSessionToken: mocks.readSessionToken,
  verifySessionToken: mocks.verifySessionToken,
  // Настоящая реализация: версия 2 отдаёт организацию, версия 1 — undefined.
  tokenTenantId: (payload: { v?: number; tenantId?: string | null }) =>
    (payload.v ?? 1) >= 2 ? payload.tenantId ?? null : undefined,
}));

vi.mock('@/core/security/tenant-context', () => ({
  setRequestTenantId: (tenantId: string | null) => {
    mocks.calls.push('setTenant:' + String(tenantId));
    mocks.setRequestTenantId(tenantId);
  },
}));

vi.mock('@/lib/db', () => ({
  db: {
    user: {
      findUnique: mocks.findUnique,
    },
  },
}));

function createRequest() {
  return new NextRequest('http://localhost/api/test', {
    headers: {
      cookie: 'pt-session=test-token',
    },
  });
}

describe('requireAuth', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.calls.length = 0;
    mocks.readSessionToken.mockReturnValue('test-token');
    mocks.findUnique.mockImplementation(() => {
      mocks.calls.push('findUnique');
      return Promise.resolve(null);
    });
  });

  it('rechecks sessionVersion for repeated requests with the same session token', async () => {
    mocks.verifySessionToken.mockResolvedValue({
      sub: 'user-1',
      email: 'operator@piling.ru',
      name: 'Operator',
      role: 'OPERATOR',
      type: 'session',
      v: 1,
    });
    mocks.findUnique
      .mockResolvedValueOnce({
      id: 'user-1',
      email: 'operator@piling.ru',
      name: 'Operator',
      role: 'OPERATOR',
      phone: '+70000000000',
      isActive: true,
      tenantId: null,
      sessionVersion: 0,
      })
      .mockResolvedValueOnce({
        id: 'user-1',
        email: 'operator@piling.ru',
        name: 'Operator',
        role: 'MECHANIC',
        phone: '+70000000000',
        isActive: true,
        tenantId: null,
        sessionVersion: 1,
      });

    const { requireAuth } = await import('../auth');

    const first = await requireAuth(createRequest());
    const second = await requireAuth(createRequest());

    expect(first.error).toBeNull();
    expect(second.user).toBeNull();
    expect(second.error?.status).toBe(401);
    expect(mocks.verifySessionToken).toHaveBeenCalledTimes(2);
    expect(mocks.findUnique).toHaveBeenCalledTimes(2);
  });

  it('returns 401 when the token session version is stale', async () => {
    mocks.verifySessionToken.mockResolvedValue({
      sub: 'user-stale',
      sv: 2,
      type: 'session',
      v: 1,
    });
    mocks.findUnique.mockResolvedValue({
      id: 'user-stale',
      email: 'operator@piling.ru',
      name: 'Operator',
      role: 'OPERATOR',
      phone: '+70000000000',
      isActive: true,
      tenantId: 'tenant-a',
      sessionVersion: 3,
    });

    const { requireAuth } = await import('../auth');
    const result = await requireAuth(createRequest());

    expect(result.user).toBeNull();
    expect(result.error?.status).toBe(401);
  });

  it('returns 401 when the session token is invalid', async () => {
    mocks.verifySessionToken.mockResolvedValue(null);

    const { requireAuth } = await import('../auth');
    const result = await requireAuth(createRequest());

    expect(result.user).toBeNull();
    expect(result.error?.status).toBe(401);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup/fixture above
    const body = await result.error!.json();
    expect(body).toMatchObject({
      error: 'Session is invalid',
    });
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // Организация в токене (версия 2)
  // ---------------------------------------------------------------------

  const userRow = (over: Record<string, unknown> = {}) => ({
    id: 'user-1',
    email: 'operator@piling.ru',
    name: 'Operator',
    role: 'OPERATOR',
    phone: '+70000000000',
    isActive: true,
    tenantId: 'orion',
    sessionVersion: 0,
    ...over,
  });

  it('организация из токена попадает в контекст ДО чтения строки пользователя', async () => {
    mocks.verifySessionToken.mockResolvedValue({
      sub: 'user-1', sv: 0, type: 'session', v: 2, tenantId: 'orion',
    });
    mocks.findUnique.mockImplementation(() => {
      mocks.calls.push('findUnique');
      return Promise.resolve(userRow());
    });

    const { requireAuth } = await import('../auth');
    const result = await requireAuth(createRequest());

    expect(result.error).toBeNull();
    // Ровно этот порядок и есть условие перевода политик в fail-closed:
    // строгая политика не отдаст строку, пока контекст не выставлен.
    expect(mocks.calls.indexOf('setTenant:orion')).toBeLessThan(mocks.calls.indexOf('findUnique'));
  });

  it('токен версии 1 организацию не несёт — порядок прежний, чтение первым', async () => {
    mocks.verifySessionToken.mockResolvedValue({
      sub: 'user-1', sv: 0, type: 'session', v: 1,
    });
    mocks.findUnique.mockImplementation(() => {
      mocks.calls.push('findUnique');
      return Promise.resolve(userRow());
    });

    const { requireAuth } = await import('../auth');
    const result = await requireAuth(createRequest());

    expect(result.error).toBeNull();
    expect(mocks.calls.indexOf('findUnique')).toBeLessThan(mocks.calls.indexOf('setTenant:orion'));
  });

  it('токен с чужой организацией отклоняется, даже когда счётчик версии совпал', async () => {
    // Пользователя перевели в другую организацию, а sessionVersion забыли
    // увеличить. Без этой проверки запрос доработал бы под организацией из
    // токена — то есть под чужой.
    mocks.verifySessionToken.mockResolvedValue({
      sub: 'user-1', sv: 0, type: 'session', v: 2, tenantId: 'stranger',
    });
    mocks.findUnique.mockResolvedValue(userRow({ tenantId: 'orion' }));

    const { requireAuth } = await import('../auth');
    const result = await requireAuth(createRequest());

    expect(result.user).toBeNull();
    expect(result.error?.status).toBe(401);
  });

  it('пользователь без организации в токене — это null, а не «спроси базу»', async () => {
    mocks.verifySessionToken.mockResolvedValue({
      sub: 'user-1', sv: 0, type: 'session', v: 2, tenantId: null,
    });
    mocks.findUnique.mockResolvedValue(userRow({ tenantId: null }));

    const { requireAuth } = await import('../auth');
    const result = await requireAuth(createRequest());

    expect(result.error).toBeNull();
    expect(mocks.calls).toContain('setTenant:null');
  });
});
