// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';

/*
  Правка и удаление документа работника.

  Держится: адрес даёт работника и документ, сессия — организацию и
  действующего пользователя; частичная правка не требует всех полей; отказ
  сервиса сохраняет свой код.
*/
const h = vi.hoisted(() => ({requireAuth: vi.fn(), updateUserDocument: vi.fn(), deleteUserDocument: vi.fn()}));

vi.mock('@/core/api-wrapper', async () => {
  const {ServiceError} = await import('@/lib/service-error');
  return {
    withMutation: (handler: unknown) => handler,
    readJsonBody: async (request: NextRequest) => {
      try { return await request.json(); } catch { throw new ServiceError('Тело запроса должно быть корректным JSON', 400); }
    },
  };
});
vi.mock('@/lib/auth', () => ({requireAuth: h.requireAuth}));
vi.mock('@/modules/users', () => ({
  updateUserDocument: h.updateUserDocument,
  deleteUserDocument: h.deleteUserDocument,
}));

import {ServiceError} from '@/lib/service-error';
import {DELETE, PUT} from '../route';

type Handler = (request: NextRequest, ctx: {params: Promise<{id: string; docId: string}>}) => Promise<Response>;
const params = {params: Promise.resolve({id: 'worker-1', docId: 'doc-1'})};
const put = (body: unknown) => (PUT as unknown as Handler)(new NextRequest('http://localhost/api/users/worker-1/documents/doc-1', {
  method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify(body),
}), params);
const del = () => (DELETE as unknown as Handler)(
  new NextRequest('http://localhost/api/users/worker-1/documents/doc-1', {method: 'DELETE'}), params,
);

const SELF = {id: 'worker-1', role: 'OPERATOR', tenantId: 'tenant-a'};

beforeEach(() => {
  vi.clearAllMocks();
  h.requireAuth.mockResolvedValue({user: SELF, error: null});
  h.updateUserDocument.mockResolvedValue({id: 'doc-1'});
  h.deleteUserDocument.mockResolvedValue(undefined);
});

describe('PUT /api/users/[id]/documents/[docId]', () => {
  it('без сессии сервис не вызывается', async () => {
    h.requireAuth.mockResolvedValue({user: null, error: new Response('{}', {status: 401})});

    expect((await put({number: '2'})).status).toBe(401);
    expect(h.updateUserDocument).not.toHaveBeenCalled();
  });

  it('частичная правка проходит; работник и документ — из адреса, контекст — из сессии', async () => {
    const response = await put({number: '  Б-2 '});

    expect(response.status).toBe(200);
    expect(h.updateUserDocument).toHaveBeenCalledWith(
      'worker-1', 'doc-1', expect.objectContaining({number: 'Б-2'}),
      {tenantId: 'tenant-a', actor: {id: 'worker-1', role: 'OPERATOR'}},
    );
  });

  it('пустая дата окончания снимает срок, а не падает', async () => {
    await put({expiresAt: null});

    expect(h.updateUserDocument.mock.calls[0][2].expiresAt).toBeNull();
  });

  it('некорректные данные: 400, сервис не вызывается', async () => {
    const response = await put({typeId: '   '});

    expect(response.status).toBe(400);
    expect(h.updateUserDocument).not.toHaveBeenCalled();
  });

  it('пользователь без организации получает отказ', async () => {
    h.requireAuth.mockResolvedValue({user: {...SELF, tenantId: undefined}, error: null});

    await expect(put({number: '1'})).rejects.toMatchObject({status: 403});
    expect(h.updateUserDocument).not.toHaveBeenCalled();
  });

  it('чужой документ: код отказа сервиса сохраняется', async () => {
    h.updateUserDocument.mockRejectedValue(new ServiceError('Документ не найден', 404));

    const response = await put({number: '1'});

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({error: 'Документ не найден'});
  });
});

describe('DELETE /api/users/[id]/documents/[docId]', () => {
  it('удаляет и отвечает ok', async () => {
    const response = await del();

    expect(await response.json()).toEqual({ok: true});
    expect(h.deleteUserDocument).toHaveBeenCalledWith(
      'worker-1', 'doc-1', {tenantId: 'tenant-a', actor: {id: 'worker-1', role: 'OPERATOR'}},
    );
  });

  it('чужой документ или нет прав: код отказа сохраняется, неожиданная ошибка пробрасывается', async () => {
    h.deleteUserDocument.mockRejectedValueOnce(new ServiceError('Нет доступа', 403));
    expect((await del()).status).toBe(403);

    h.deleteUserDocument.mockRejectedValueOnce(new Error('сбой'));
    await expect(del()).rejects.toThrow('сбой');
  });
});
