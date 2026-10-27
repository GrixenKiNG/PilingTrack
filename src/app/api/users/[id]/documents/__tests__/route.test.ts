// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';

/*
  Документы работника: маршрут только передаёт запрос сервису.

  Держится:
  - организация и действующий пользователь берутся из сессии, а не из тела и адреса;
  - пользователь без организации получает отказ до обращения к сервису;
  - тело проверяется схемой (даты приводятся, пустые строки дат — «нет даты»);
  - отказ сервиса становится ответом с его кодом, чужая ошибка не глотается.
*/
const h = vi.hoisted(() => ({requireAuth: vi.fn(), listUserDocuments: vi.fn(), createUserDocument: vi.fn()}));

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
vi.mock('@/modules/users', () => ({
  listUserDocuments: h.listUserDocuments,
  createUserDocument: h.createUserDocument,
}));

import {ServiceError} from '@/lib/service-error';
import {GET, POST} from '../route';

type Handler = (request: NextRequest, ctx: {params: Promise<{id: string}>}) => Promise<Response>;
const params = {params: Promise.resolve({id: 'worker-1'})};
const get = () => (GET as unknown as Handler)(new NextRequest('http://localhost/api/users/worker-1/documents'), params);
const post = (body: unknown) => (POST as unknown as Handler)(new NextRequest('http://localhost/api/users/worker-1/documents', {
  method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body),
}), params);

const ADMIN = {id: 'admin-1', role: 'ADMIN', tenantId: 'tenant-a'};

beforeEach(() => {
  vi.clearAllMocks();
  h.requireAuth.mockResolvedValue({user: ADMIN, error: null});
  h.listUserDocuments.mockResolvedValue([]);
  h.createUserDocument.mockResolvedValue({id: 'doc-1'});
});

describe('GET /api/users/[id]/documents', () => {
  it('без сессии отдаёт ответ проверки и не зовёт сервис', async () => {
    h.requireAuth.mockResolvedValue({user: null, error: new Response('{}', {status: 401})});

    expect((await get()).status).toBe(401);
    expect(h.listUserDocuments).not.toHaveBeenCalled();
  });

  it('передаёт работника из адреса, а организацию и пользователя — из сессии', async () => {
    h.listUserDocuments.mockResolvedValue([{id: 'doc-1'}]);

    const response = await get();

    expect(await response.json()).toEqual({documents: [{id: 'doc-1'}]});
    expect(h.listUserDocuments).toHaveBeenCalledWith('worker-1', {tenantId: 'tenant-a', actor: {id: 'admin-1', role: 'ADMIN'}});
  });

  it('пользователь без организации получает отказ, сервис не вызывается', async () => {
    h.requireAuth.mockResolvedValue({user: {...ADMIN, tenantId: null}, error: null});

    await expect(get()).rejects.toMatchObject({status: 403});
    expect(h.listUserDocuments).not.toHaveBeenCalled();
  });

  it('отказ сервиса сохраняет свой код, чужая ошибка пробрасывается', async () => {
    h.listUserDocuments.mockRejectedValueOnce(new ServiceError('Нет доступа', 403));
    const denied = await get();
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({error: 'Нет доступа'});

    h.listUserDocuments.mockRejectedValueOnce(new Error('база недоступна'));
    await expect(get()).rejects.toThrow('база недоступна');
  });
});

describe('POST /api/users/[id]/documents', () => {
  it('создаёт документ: даты приводятся, null вместо даты — «нет даты»', async () => {
    const response = await post({typeId: 'type-1', number: ' А-1 ', issuedAt: '2026-10-01', expiresAt: null});

    expect(response.status).toBe(201);
    const [workerId, input, ctx] = h.createUserDocument.mock.calls[0];
    expect(workerId).toBe('worker-1');
    expect(input.number).toBe('А-1');
    expect(input.issuedAt).toEqual(new Date('2026-10-01'));
    expect(input.expiresAt).toBeNull();
    expect(ctx).toEqual({tenantId: 'tenant-a', actor: {id: 'admin-1', role: 'ADMIN'}});
  });

  it('пустая строка вместо даты — «не указано» (внешний клиент без null), мусор вместо даты — по-прежнему 400', async () => {
    const ok = await post({typeId: 'type-1', issuedAt: '', expiresAt: ''});

    expect(ok.status).toBe(201);
    expect(h.createUserDocument.mock.calls[0][1].expiresAt).toBeUndefined();
    expect((await post({typeId: 'type-1', expiresAt: 'вчера'})).status).toBe(400);
  });

  it('организацию из тела запроса игнорирует', async () => {
    await post({typeId: 'type-1', tenantId: 'tenant-evil'});

    expect(h.createUserDocument.mock.calls[0][2].tenantId).toBe('tenant-a');
    expect(h.createUserDocument.mock.calls[0][1]).not.toHaveProperty('tenantId');
  });

  it.each([
    ['нет вида документа', {number: '1'}],
    ['пустой вид документа', {typeId: '   '}],
    ['слишком длинный номер', {typeId: 't', number: 'x'.repeat(101)}],
    ['слишком длинная заметка', {typeId: 't', notes: 'x'.repeat(2001)}],
    ['дата не дата', {typeId: 't', issuedAt: 'не дата'}],
  ])('%s: 400 с перечнем полей, сервис не вызывается', async (_name, body) => {
    const response = await post(body);

    expect(response.status).toBe(400);
    expect((await response.json()).details.length).toBeGreaterThan(0);
    expect(h.createUserDocument).not.toHaveBeenCalled();
  });

  it('тело не JSON: 400 от разбора тела', async () => {
    const request = new NextRequest('http://localhost/api/users/worker-1/documents', {
      method: 'POST', headers: {'content-type': 'application/json'}, body: '{не json',
    });

    await expect((POST as unknown as Handler)(request, params)).rejects.toMatchObject({status: 400});
  });

  it('отказ сервиса (чужой работник) становится его кодом', async () => {
    h.createUserDocument.mockRejectedValue(new ServiceError('Нет доступа', 403));

    expect((await post({typeId: 'type-1'})).status).toBe(403);
  });
});
