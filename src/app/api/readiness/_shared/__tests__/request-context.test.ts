import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';

const mocks = vi.hoisted(() => ({requireAuth: vi.fn()}));

vi.mock('@/lib/auth', () => ({requireAuth: mocks.requireAuth}));
// Матрица доступов читается из базы на каждом запросе. Здесь проверяется
// граница доверия — тенант, актор и роль берутся только из сессии, — поэтому
// загрузка матрицы подменяется, а не поднимается база.
vi.mock('@/modules/readiness/application/access-matrix-service', () => ({
  getPublishedAccessMatrix: vi.fn().mockResolvedValue({
    version: 'v1.0',
    status: 'PUBLISHED',
    // Права ролям здесь заданы явно, а не пустой матрицей: проверка ниже
    // должна показывать сужение полномочий при замещении, а на пустой
    // матрице любая роль получает пустой набор и сужать нечего.
    grants: {
      ADMIN: ['readiness.read', 'readiness.defect.report', 'readiness.rules.manage'],
      MECHANIC: ['readiness.read', 'readiness.defect.report'],
    },
  }),
}));

import {resolveReadinessRequestContext} from '../request-context';

const request = (headers: Record<string, string> = {}) => new NextRequest(
  'http://localhost/api/readiness/work-permits',
  {headers},
);

describe('readiness request context trust boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({
      user: {
        id: 'dispatcher-session',
        name: 'Dispatcher',
        role: 'DISPATCHER',
        tenantId: 'tenant-session',
      },
      error: null,
    });
  });

  it('takes tenant, actor and role only from the authenticated session', async () => {
    const result = await resolveReadinessRequestContext(request({
      'x-tenant-id': 'tenant-foreign',
      'x-actor-id': 'admin-foreign',
      'x-role': 'ADMIN',
      'x-timezone': 'UTC',
    }));

    expect(result.context).toMatchObject({
      tenantId: 'tenant-session',
      actorId: 'dispatcher-session',
      actorRole: 'DISPATCHER',
      actingAs: null,
    });
  });

  it('ignores an acting role sent in a header — it comes from the session', async () => {
    // Заголовок с исполняемой ролью раньше читался здесь напрямую. Теперь
    // роль приходит только из `requireAuth`, который её и проверяет, поэтому
    // любой заголовок должен остаться без последствий.
    const result = await resolveReadinessRequestContext(request({
      'x-readiness-acting-as': 'MECHANIC',
      'x-acting-as': 'MECHANIC',
    }));
    expect(result.context?.actingAs).toBeNull();
  });

  it('gives an admin acting as mechanic the capabilities of a mechanic', async () => {
    // Главная проверка исправления: раньше замещение доходило до сервера
    // только через особый заголовок, который дописывали три экрана из
    // десятка. Все прочие команды администратор в режиме механика выполнял
    // с полными правами администратора, а в журнал шло «замещения не было».
    mocks.requireAuth.mockResolvedValue({
      user: {
        id: 'admin-session',
        name: 'Admin',
        role: 'ADMIN',
        tenantId: 'tenant-session',
        actingAs: 'MECHANIC',
      },
      error: null,
    });

    const result = await resolveReadinessRequestContext(request());

    expect(result.context?.actingAs).toBe('MECHANIC');
    expect(result.context?.capabilities.has('readiness.defect.report')).toBe(true);
    expect(result.context?.capabilities.has('readiness.rules.manage')).toBe(false);
  });
});
