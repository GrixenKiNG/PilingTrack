// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';

/*
  Загрузка файлов: ссылка на загрузку и список по объекту.

  Держится:
  - доступ к объекту (отчёт, установка, ТО…) проверяется ДО выдачи ссылки на
    загрузку и ДО списка файлов;
  - организация берётся из сессии: список ищется только в ней, а в запрос на
    загрузку не попадает ничего из тела, кроме описания файла;
  - без имени и типа файла ссылка не выдаётся.
*/
const h = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  assertCanAccessMediaEntity: vi.fn(),
  getPresignedUrl: vi.fn(),
  listByEntity: vi.fn(),
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
vi.mock('@/core/media/media-auth', () => ({assertCanAccessMediaEntity: h.assertCanAccessMediaEntity}));
vi.mock('@/core/media/media-service', () => ({
  getMediaService: () => ({getPresignedUrl: h.getPresignedUrl, listByEntity: h.listByEntity}),
}));

import {ServiceError} from '@/services/service-error';
import {GET, POST} from '../route';

type Handler = (request: NextRequest) => Promise<Response>;
const post = (body: unknown) => (POST as unknown as Handler)(new NextRequest('http://localhost/api/media', {
  method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body),
}));
const get = (query: string) => (GET as unknown as Handler)(new NextRequest(`http://localhost/api/media${query}`));

const USER = {id: 'op-1', role: 'OPERATOR', tenantId: 'tenant-a'};
const UPLOAD = {fileName: 'photo.jpg', contentType: 'image/jpeg', fileSize: 1000, entityType: 'report', entityId: 'R-1'};

beforeEach(() => {
  vi.clearAllMocks();
  h.assertCanAccessMediaEntity.mockReset();
  h.requireAuth.mockResolvedValue({user: USER, error: null});
  h.getPresignedUrl.mockResolvedValue({uploadUrl: 'https://s3.example/put', mediaId: 'm-1'});
  h.listByEntity.mockResolvedValue([{id: 'm-1'}]);
});

describe('POST /api/media — ссылка на загрузку', () => {
  it('без сессии ничего не выдаётся', async () => {
    h.requireAuth.mockResolvedValue({user: null, error: new Response('{}', {status: 401})});

    expect((await post(UPLOAD)).status).toBe(401);
    expect(h.getPresignedUrl).not.toHaveBeenCalled();
  });

  it.each([
    ['нет имени файла', {contentType: 'image/jpeg'}],
    ['нет типа содержимого', {fileName: 'photo.jpg'}],
  ])('%s: 400, объект и хранилище не трогаются', async (_name, body) => {
    const response = await post(body);

    expect(response.status).toBe(400);
    expect(h.assertCanAccessMediaEntity).not.toHaveBeenCalled();
    expect(h.getPresignedUrl).not.toHaveBeenCalled();
  });

  it('доступ к объекту проверяется до выдачи ссылки; отказ сохраняет свой код', async () => {
    h.assertCanAccessMediaEntity.mockRejectedValue(new ServiceError('Нет доступа', 403));

    const response = await post(UPLOAD);

    expect(response.status).toBe(403);
    expect(h.assertCanAccessMediaEntity).toHaveBeenCalledWith(USER, 'report', 'R-1');
    expect(h.getPresignedUrl).not.toHaveBeenCalled();
  });

  it('неожиданная ошибка проверки доступа не превращается в разрешение', async () => {
    h.assertCanAccessMediaEntity.mockRejectedValue(new Error('база недоступна'));

    await expect(post(UPLOAD)).rejects.toThrow('база недоступна');
    expect(h.getPresignedUrl).not.toHaveBeenCalled();
  });

  it('организация и автор — из сессии, не из тела', async () => {
    const response = await post({...UPLOAD, tenantId: 'tenant-evil', userId: 'someone-else'});

    expect(response.status).toBe(200);
    expect(h.getPresignedUrl).toHaveBeenCalledWith({
      fileName: 'photo.jpg', contentType: 'image/jpeg', fileSize: 1000,
      tenantId: 'tenant-a', userId: 'op-1', entityType: 'report', entityId: 'R-1',
    });
    expect(response.headers.get('X-Request-Id')).not.toBeNull();
  });

  it('пользователь без организации получает отказ до выдачи ссылки', async () => {
    h.requireAuth.mockResolvedValue({user: {...USER, tenantId: null}, error: null});

    await expect(post(UPLOAD)).rejects.toMatchObject({status: 403});
    expect(h.getPresignedUrl).not.toHaveBeenCalled();
  });

  it('тело «null» не роняет маршрут в 500', async () => {
    const response = await post(null);

    expect(response.status).toBe(400);
  });
});

describe('GET /api/media — список по объекту', () => {
  it('без объекта: 400', async () => {
    expect((await get('?entityType=report')).status).toBe(400);
    expect((await get('?entityId=R-1')).status).toBe(400);
    expect(h.listByEntity).not.toHaveBeenCalled();
  });

  it('доступ проверяется на чтение; отказ — до списка', async () => {
    h.assertCanAccessMediaEntity.mockRejectedValue(new ServiceError('Нет доступа', 403));

    const response = await get('?entityType=report&entityId=R-1');

    expect(response.status).toBe(403);
    expect(h.assertCanAccessMediaEntity).toHaveBeenCalledWith(USER, 'report', 'R-1', 'read');
    expect(h.listByEntity).not.toHaveBeenCalled();
  });

  it('список ищется только в организации сессии', async () => {
    const response = await get('?entityType=report&entityId=R-1');

    expect(await response.json()).toEqual({data: [{id: 'm-1'}]});
    expect(h.listByEntity).toHaveBeenCalledWith('report', 'R-1', 'tenant-a');
  });

  it('пользователь без организации получает отказ до списка', async () => {
    h.requireAuth.mockResolvedValue({user: {...USER, tenantId: undefined}, error: null});

    await expect(get('?entityType=report&entityId=R-1')).rejects.toMatchObject({status: 403});
    expect(h.listByEntity).not.toHaveBeenCalled();
  });
});
