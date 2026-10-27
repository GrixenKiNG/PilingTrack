// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';

/*
  Выдача ссылки на файл: кому, когда и какой.

  Держится:
  - без сессии и для чужого файла ссылки нет, S3 не вызывается;
  - удалённый файл — 404, недогруженный — 409;
  - файл работника может открыть он сам, даже если общее правило ему отказало
    (документы за него грузит администратор);
  - миниатюра отдаётся, только если она реально лежит в хранилище, иначе —
    оригинал (старые записи имеют ключ без объекта).
*/
const h = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  mediaFindUnique: vi.fn(),
  assertCanAccessMedia: vi.fn(),
  ownsUserDocumentMedia: vi.fn(),
  getSignedUrl: vi.fn(),
  send: vi.fn(),
}));

vi.mock('@/core/api-wrapper', () => ({withApi: (handler: unknown) => handler}));
vi.mock('@/lib/auth', () => ({requireAuth: h.requireAuth}));
vi.mock('@/lib/db', () => ({db: {media: {findUnique: h.mediaFindUnique}}}));
vi.mock('@/core/media/media-auth', () => ({
  assertCanAccessMedia: h.assertCanAccessMedia,
  ownsUserDocumentMedia: h.ownsUserDocumentMedia,
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({getSignedUrl: h.getSignedUrl}));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { send = h.send; },
  GetObjectCommand: class { constructor(public input: {Key: string}) {} },
  HeadObjectCommand: class { constructor(public input: {Key: string}) {} },
}));

import {ServiceError} from '@/services/service-error';
import {GET} from '../route';

type Handler = (request: NextRequest, ctx: {params: Promise<{id: string}>}) => Promise<Response>;
const call = (query = '') => (GET as unknown as Handler)(
  new NextRequest(`http://localhost/api/media/m-1/download${query}`),
  {params: Promise.resolve({id: 'm-1'})},
);

const USER = {id: 'u-1', role: 'OPERATOR', tenantId: 'tenant-a'};
const media = (overrides: Record<string, unknown> = {}) => ({
  key: 'orig.jpg', thumbnailKey: 'thumb.jpg', entityType: 'report', entityId: 'R-1', isDeleted: false,
  uploadStatus: 'completed', userId: 'u-1', tenantId: 'tenant-a', ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.assertCanAccessMedia.mockReset();
  h.send.mockReset();
  h.requireAuth.mockResolvedValue({user: USER, error: null});
  h.mediaFindUnique.mockResolvedValue(media());
  h.getSignedUrl.mockResolvedValue('https://s3.example/signed');
  h.ownsUserDocumentMedia.mockResolvedValue(false);
  h.send.mockResolvedValue({});
});

describe('GET /api/media/[id]/download', () => {
  it('без сессии отдаёт ответ проверки и не трогает базу и хранилище', async () => {
    h.requireAuth.mockResolvedValue({user: null, error: new Response('{}', {status: 401})});

    const response = await call();

    expect(response.status).toBe(401);
    expect(h.mediaFindUnique).not.toHaveBeenCalled();
    expect(h.getSignedUrl).not.toHaveBeenCalled();
  });

  it('нет записи или она удалена — 404', async () => {
    h.mediaFindUnique.mockResolvedValue(null);
    expect((await call()).status).toBe(404);

    h.mediaFindUnique.mockResolvedValue(media({isDeleted: true}));
    expect((await call()).status).toBe(404);
    expect(h.getSignedUrl).not.toHaveBeenCalled();
  });

  it('загрузка не завершена — 409', async () => {
    h.mediaFindUnique.mockResolvedValue(media({uploadStatus: 'pending'}));

    expect((await call()).status).toBe(409);
    expect(h.getSignedUrl).not.toHaveBeenCalled();
  });

  it('чужой файл: отказ правила доступа становится 403, ссылка не выдаётся', async () => {
    h.assertCanAccessMedia.mockImplementation(() => { throw new ServiceError('Нет доступа', 403); });

    const response = await call();

    expect(response.status).toBe(403);
    expect(h.ownsUserDocumentMedia).toHaveBeenCalledWith(USER, 'm-1');
    expect(h.getSignedUrl).not.toHaveBeenCalled();
  });

  it('собственный документ открывается, даже если общее правило отказало', async () => {
    h.assertCanAccessMedia.mockImplementation(() => { throw new ServiceError('Нет доступа', 403); });
    h.ownsUserDocumentMedia.mockResolvedValue(true);

    const response = await call();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({url: 'https://s3.example/signed', expiresIn: 3600});
  });

  it('неожиданная ошибка правила не превращается в доступ', async () => {
    h.assertCanAccessMedia.mockImplementation(() => { throw new Error('сбой'); });

    await expect(call()).rejects.toThrow('сбой');
    expect(h.getSignedUrl).not.toHaveBeenCalled();
  });

  it('правило проверяется на чтение с учётом организации файла', async () => {
    await call();

    expect(h.assertCanAccessMedia).toHaveBeenCalledWith(USER, expect.objectContaining({tenantId: 'tenant-a'}), 'read');
  });

  it('миниатюра есть в хранилище — ссылка на неё; нет — на оригинал', async () => {
    await call('?thumb=1');
    expect(h.getSignedUrl.mock.calls[0][1].input.Key).toBe('thumb.jpg');

    h.send.mockRejectedValue(new Error('NotFound'));
    await call('?thumb=1');
    expect(h.getSignedUrl.mock.calls[1][1].input.Key).toBe('orig.jpg');
  });

  it('без запроса миниатюры отдаётся оригинал и хранилище не опрашивается', async () => {
    await call();

    expect(h.send).not.toHaveBeenCalled();
    expect(h.getSignedUrl.mock.calls[0][1].input.Key).toBe('orig.jpg');
  });
});
