// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';

/*
  Создание бригады: организация вызывающего доходит до команды.

  Раньше `createCrew` сверял машиниста, установку и объект только друг с другом,
  но не с организацией вызывающего: пользователь одной организации, зная id из
  другой, мог собрать бригаду из чужих частей. Здесь держится, что маршрут
  передаёт организацию из СЕССИИ (не из тела), а право управлять бригадами
  проверяется настоящей матрицей ролей.
*/
const h = vi.hoisted(() => ({requireAuth: vi.fn(), createCrew: vi.fn(), invalidateCrewsCache: vi.fn()}));

vi.mock('@/core/api-wrapper', async () => {
  const {ServiceError} = await import('@/lib/service-error');
  return {
    withApi: (handler: unknown) => handler,
    withMutation: (handler: unknown) => handler,
    readJsonBody: async (request: NextRequest) => {
      try { return await request.json(); } catch { throw new ServiceError('Тело запроса должно быть корректным JSON', 400); }
    },
  };
});
vi.mock('@/lib/auth', () => ({requireAuth: h.requireAuth}));
vi.mock('../cache', () => ({invalidateCrewsCache: h.invalidateCrewsCache}));
vi.mock('@/modules/crews', () => ({createCrew: h.createCrew}));

import {POST} from '../route';

type Handler = (request: NextRequest) => Promise<Response>;
const post = (body: unknown) => (POST as unknown as Handler)(new NextRequest('http://localhost/api/crews', {
  method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body),
}));

const as = (role: string) => ({id: 'u-1', name: 'Имя', role, tenantId: 'tenant-a'});
const CREW = {name: 'Бригада 1', operatorId: 'op-1', equipmentId: 'eq-1', siteId: 'site-1'};

beforeEach(() => {
  vi.clearAllMocks();
  h.requireAuth.mockResolvedValue({user: as('DISPATCHER'), error: null});
  h.createCrew.mockResolvedValue({id: 'crew-1'});
});

describe('POST /api/crews', () => {
  it('организация передаётся в команду из сессии', async () => {
    const response = await post(CREW);

    expect(response.status).toBe(200);
    expect(h.createCrew).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a', operatorId: 'op-1', equipmentId: 'eq-1', siteId: 'site-1', userId: 'u-1',
    }));
    expect(h.invalidateCrewsCache).toHaveBeenCalled();
  });

  it('организация из тела запроса не принимается', async () => {
    await post({...CREW, tenantId: 'tenant-evil'});

    expect(h.createCrew.mock.calls[0][0].tenantId).toBe('tenant-a');
  });

  it('пользователь без организации получает отказ до команды', async () => {
    h.requireAuth.mockResolvedValue({user: {...as('ADMIN'), tenantId: null}, error: null});

    await expect(post(CREW)).rejects.toMatchObject({status: 403});
    expect(h.createCrew).not.toHaveBeenCalled();
  });

  it.each(['OPERATOR', 'MECHANIC', 'FOREMAN', 'SAFETY_ENGINEER', 'ASSISTANT'])('роль %s бригады не заводит', async (role) => {
    h.requireAuth.mockResolvedValue({user: as(role), error: null});

    await expect(post(CREW)).rejects.toMatchObject({status: 403});
    expect(h.createCrew).not.toHaveBeenCalled();
  });

  it('некорректные данные: 400, команда не вызывается', async () => {
    const response = await post({name: 'Без состава'});

    expect(response.status).toBe(400);
    expect(h.createCrew).not.toHaveBeenCalled();
  });
});
