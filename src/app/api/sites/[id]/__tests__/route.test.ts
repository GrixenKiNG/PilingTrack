// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';

/*
  Карточка объекта: чтение, правка, удаление.

  Права и схему тела здесь НЕ подменяем — проверяем подключение к настоящим.
  Держится:
  - правка планов не идёт в ветку «простая правка», и наоборот; пустой массив
    планов — осознанная очистка, а не отсутствие поля;
  - координаты — самостоятельный повод сохранить объект;
  - организация и действующий пользователь — из сессии;
  - без права управлять объектами сервисы не вызываются;
  - жёсткое удаление идёт с организацией и пользователем, кэш объектов сбрасывается.
*/
const h = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getSiteWithHierarchy: vi.fn(),
  updateSite: vi.fn(),
  updateSiteWithPlans: vi.fn(),
  activateSite: vi.fn(),
  deactivateSite: vi.fn(),
  hardDeleteSite: vi.fn(),
  setSiteCompleted: vi.fn(),
  invalidateSites: vi.fn(),
}));

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
vi.mock('@/lib/cached-queries', () => ({invalidateSites: h.invalidateSites}));
vi.mock('@/modules/sites', () => ({
  getSiteWithHierarchy: h.getSiteWithHierarchy,
  updateSite: h.updateSite,
  updateSiteWithPlans: h.updateSiteWithPlans,
  activateSite: h.activateSite,
  deactivateSite: h.deactivateSite,
  hardDeleteSite: h.hardDeleteSite,
  setSiteCompleted: h.setSiteCompleted,
}));

import {DELETE, GET, PUT} from '../route';

type Handler = (request: NextRequest, ctx: {params: Promise<{id: string}>}) => Promise<Response>;
const params = {params: Promise.resolve({id: 'site-1'})};
const get = () => (GET as unknown as Handler)(new NextRequest('http://localhost/api/sites/site-1'), params);
const put = (body: unknown) => (PUT as unknown as Handler)(new NextRequest('http://localhost/api/sites/site-1', {
  method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify(body),
}), params);
const del = () => (DELETE as unknown as Handler)(new NextRequest('http://localhost/api/sites/site-1', {method: 'DELETE'}), params);

const ADMIN = {id: 'admin-1', role: 'ADMIN', tenantId: 'tenant-a'};
const OPERATOR = {id: 'op-1', role: 'OPERATOR', tenantId: 'tenant-a'};
const CTX = {tenantId: 'tenant-a', actorId: 'admin-1'};

beforeEach(() => {
  vi.clearAllMocks();
  h.requireAuth.mockResolvedValue({user: ADMIN, error: null});
  h.getSiteWithHierarchy.mockResolvedValue({id: 'site-1', name: 'Объект'});
  h.updateSite.mockResolvedValue({id: 'site-1', name: 'после простой правки'});
  h.updateSiteWithPlans.mockResolvedValue({id: 'site-1', name: 'после правки с планами'});
});

describe('GET /api/sites/[id]', () => {
  it('читает объект с организацией из сессии', async () => {
    const response = await get();

    expect(await response.json()).toEqual({site: {id: 'site-1', name: 'Объект'}});
    expect(h.getSiteWithHierarchy).toHaveBeenCalledWith(ADMIN, 'tenant-a', 'site-1');
  });

  it('объекта нет или он чужой — 404', async () => {
    h.getSiteWithHierarchy.mockResolvedValue(null);

    await expect(get()).rejects.toMatchObject({status: 404});
  });

  it('пользователь без организации получает отказ до чтения', async () => {
    h.requireAuth.mockResolvedValue({user: {...ADMIN, tenantId: null}, error: null});

    await expect(get()).rejects.toMatchObject({status: 403});
    expect(h.getSiteWithHierarchy).not.toHaveBeenCalled();
  });
});

describe('PUT /api/sites/[id]', () => {
  it('оператор не управляет объектами: сервисы не вызываются', async () => {
    h.requireAuth.mockResolvedValue({user: OPERATOR, error: null});

    await expect(put({name: 'Новое'})).rejects.toMatchObject({status: 403});
    expect(h.updateSite).not.toHaveBeenCalled();
    expect(h.updateSiteWithPlans).not.toHaveBeenCalled();
  });

  it('некорректное тело: 400, ничего не меняется', async () => {
    const response = await put({plannedPiles: 'много'});

    expect(response.status).toBe(400);
    expect(h.updateSite).not.toHaveBeenCalled();
  });

  it('простая правка названия идёт без планов', async () => {
    const response = await put({name: 'Новое'});

    expect(h.updateSite).toHaveBeenCalledWith(expect.objectContaining({siteId: 'site-1', name: 'Новое'}), CTX);
    expect(h.updateSiteWithPlans).not.toHaveBeenCalled();
    expect(h.invalidateSites).toHaveBeenCalledWith('tenant-a');
    expect((await response.json()).site.name).toBe('после простой правки');
  });

  it('правка одних координат — тоже правка', async () => {
    await put({latitude: 55.75, longitude: 37.62});

    expect(h.updateSite).toHaveBeenCalledWith(
      expect.objectContaining({siteId: 'site-1', latitude: 55.75, longitude: 37.62}), CTX,
    );
  });

  it('пришли планы — идёт ветка с планами', async () => {
    await put({name: 'Новое', pilePlans: [{pileGradeId: 'g-1', count: 10}]});

    expect(h.updateSiteWithPlans).toHaveBeenCalledWith(
      'site-1', expect.objectContaining({name: 'Новое', pilePlans: [{pileGradeId: 'g-1', count: 10}]}), CTX,
    );
    expect(h.updateSite).not.toHaveBeenCalled();
  });

  it('пустой массив планов — осознанная очистка, а не отсутствие поля', async () => {
    await put({drillingPlans: []});

    expect(h.updateSiteWithPlans).toHaveBeenCalledWith('site-1', expect.objectContaining({drillingPlans: []}), CTX);
  });

  it('только переключение активности: ни простой правки, ни планов, объект перечитывается', async () => {
    await put({isActive: false});
    expect(h.deactivateSite).toHaveBeenCalledWith('site-1', CTX);
    expect(h.updateSite).not.toHaveBeenCalled();

    await put({isActive: true});
    expect(h.activateSite).toHaveBeenCalledWith('site-1', CTX);
    expect(h.getSiteWithHierarchy).toHaveBeenCalledTimes(2);
  });

  it('отметка «завершён» идёт отдельной командой', async () => {
    await put({completed: true});

    expect(h.setSiteCompleted).toHaveBeenCalledWith('site-1', true, CTX);
    expect(h.updateSite).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/sites/[id]', () => {
  it('оператор не удаляет объекты', async () => {
    h.requireAuth.mockResolvedValue({user: OPERATOR, error: null});

    await expect(del()).rejects.toMatchObject({status: 403});
    expect(h.hardDeleteSite).not.toHaveBeenCalled();
  });

  it('жёсткое удаление идёт с организацией и пользователем, кэш объектов сбрасывается', async () => {
    const response = await del();

    expect(h.hardDeleteSite).toHaveBeenCalledWith('site-1', CTX);
    expect(h.invalidateSites).toHaveBeenCalledWith('tenant-a');
    expect(await response.json()).toEqual({ok: true, siteId: 'site-1'});
  });
});
