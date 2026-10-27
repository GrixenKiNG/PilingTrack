// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';

/*
  Допуски работников к технике. Права НЕ подменяем — проверяем подключение к
  настоящей матрице ролей.

  Держится:
  - свои допуски человек видит всегда, чужие — только роли с правом читать все
    документы (администратор, диспетчер, инженер ОТ);
  - выдавать допуск вправе только администратор и инженер ОТ: диспетчер читает,
    но решения по охране труда не принимает;
  - организация — из сессии, срок приводится к дате, пустой срок — «бессрочно».
*/
const h = vi.hoisted(() => ({requireAuth: vi.fn(), listEquipmentPermits: vi.fn(), upsertEquipmentPermit: vi.fn()}));

vi.mock('@/core/api-wrapper', () => ({withApi: (handler: unknown) => handler, withMutation: (handler: unknown) => handler}));
vi.mock('@/lib/auth', () => ({requireAuth: h.requireAuth}));
vi.mock('@/modules/safety', () => ({
  listEquipmentPermits: h.listEquipmentPermits,
  upsertEquipmentPermit: h.upsertEquipmentPermit,
}));

import {ServiceError} from '@/lib/service-error';
import {GET, POST} from '../route';

type Handler = (request: NextRequest) => Promise<Response>;
const get = (query = '') => (GET as unknown as Handler)(new NextRequest(`http://localhost/api/safety/equipment-permits${query}`));
const post = (body: unknown, raw = false) => (POST as unknown as Handler)(new NextRequest('http://localhost/api/safety/equipment-permits', {
  method: 'POST', headers: {'content-type': 'application/json'}, body: raw ? String(body) : JSON.stringify(body),
}));

const as = (role: string, id = 'u-1') => ({id, name: 'Имя', role, tenantId: 'tenant-a'});
const PERMIT = {userId: 'worker-1', equipmentKind: 'PILE_DRIVER', scope: 'OPERATION', status: 'ALLOWED'};

beforeEach(() => {
  vi.clearAllMocks();
  h.requireAuth.mockResolvedValue({user: as('SAFETY_ENGINEER', 'eng-1'), error: null});
  h.listEquipmentPermits.mockResolvedValue([]);
  h.upsertEquipmentPermit.mockResolvedValue({id: 'p-1'});
});

describe('GET /api/safety/equipment-permits', () => {
  it('без параметра читает свои допуски, и это разрешено любой роли', async () => {
    h.requireAuth.mockResolvedValue({user: as('OPERATOR', 'op-1'), error: null});

    await get();

    expect(h.listEquipmentPermits).toHaveBeenCalledWith({tenantId: 'tenant-a', userId: 'op-1', mayRead: true});
  });

  it('чужие допуски: оператору нельзя', async () => {
    h.requireAuth.mockResolvedValue({user: as('OPERATOR', 'op-1'), error: null});

    await get('?userId=worker-1');

    expect(h.listEquipmentPermits).toHaveBeenCalledWith({tenantId: 'tenant-a', userId: 'worker-1', mayRead: false});
  });

  it.each(['ADMIN', 'DISPATCHER', 'SAFETY_ENGINEER'])('чужие допуски: роли %s можно', async (role) => {
    h.requireAuth.mockResolvedValue({user: as(role), error: null});

    await get('?userId=worker-1');

    expect(h.listEquipmentPermits.mock.calls[0][0].mayRead).toBe(true);
  });

  it('отказ сервиса сохраняет код, чужая ошибка пробрасывается', async () => {
    h.listEquipmentPermits.mockRejectedValueOnce(new ServiceError('Нет доступа', 403));
    expect((await get('?userId=worker-1')).status).toBe(403);

    h.listEquipmentPermits.mockRejectedValueOnce(new Error('сбой'));
    await expect(get()).rejects.toThrow('сбой');
  });

  it('пользователь без организации получает отказ до чтения', async () => {
    h.requireAuth.mockResolvedValue({user: {...as('ADMIN'), tenantId: null}, error: null});

    await expect(get()).rejects.toMatchObject({status: 403});
    expect(h.listEquipmentPermits).not.toHaveBeenCalled();
  });
});

describe('POST /api/safety/equipment-permits', () => {
  it('без сессии допуск не выдаётся', async () => {
    h.requireAuth.mockResolvedValue({user: null, error: new Response('{}', {status: 401})});

    expect((await post(PERMIT)).status).toBe(401);
    expect(h.upsertEquipmentPermit).not.toHaveBeenCalled();
  });

  it.each([
    ['ADMIN', true], ['SAFETY_ENGINEER', true], ['DISPATCHER', false], ['OPERATOR', false], ['MECHANIC', false],
  ])('право выдавать допуск у роли %s: %s', async (role, allowed) => {
    h.requireAuth.mockResolvedValue({user: as(role), error: null});

    await post(PERMIT);

    expect(h.upsertEquipmentPermit.mock.calls[0][0].mayManage).toBe(allowed);
  });

  it('организация и исполнитель — из сессии; срок приводится к дате', async () => {
    const response = await post({...PERMIT, tenantId: 'tenant-evil', validUntil: '2027-01-01T00:00:00.000Z', restriction: 'до ветра 10 м/с'});

    expect(response.status).toBe(201);
    const call = h.upsertEquipmentPermit.mock.calls[0][0];
    expect(call).toMatchObject({tenantId: 'tenant-a', userId: 'worker-1', actor: {id: 'eng-1', name: 'Имя'}});
    expect(call.payload.validUntil).toEqual(new Date('2027-01-01T00:00:00.000Z'));
    expect(call.payload).toMatchObject({status: 'ALLOWED', restriction: 'до ветра 10 м/с'});
    expect(call.payload).not.toHaveProperty('tenantId');
  });

  it('срок не указан или null — бессрочно', async () => {
    await post(PERMIT);
    await post({...PERMIT, validUntil: null});

    expect(h.upsertEquipmentPermit.mock.calls.map(([call]) => call.payload.validUntil)).toEqual([null, null]);
  });

  it.each([
    ['неизвестный вид техники', {...PERMIT, equipmentKind: 'ROCKET'}],
    ['неизвестная область', {...PERMIT, scope: 'EVERYTHING'}],
    ['неизвестный статус', {...PERMIT, status: 'MAYBE'}],
    ['срок не дата', {...PERMIT, validUntil: 'скоро'}],
    ['слишком длинное ограничение', {...PERMIT, restriction: 'x'.repeat(501)}],
    ['нет работника', {equipmentKind: 'PILE_DRIVER', scope: 'OPERATION', status: 'ALLOWED'}],
  ])('%s: 400, сервис не вызывается', async (_name, body) => {
    expect((await post(body)).status).toBe(400);
    expect(h.upsertEquipmentPermit).not.toHaveBeenCalled();
  });

  it('тело не JSON: 400 без падения', async () => {
    expect((await post('{не json', true)).status).toBe(400);
  });

  it('отказ сервиса (нет права) отдаётся с его кодом', async () => {
    h.upsertEquipmentPermit.mockRejectedValue(new ServiceError('Недостаточно прав', 403));

    expect((await post(PERMIT)).status).toBe(403);
  });
});
