// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';

/*
  Ссылки на несколько файлов за один запрос (миниатюры журнала).

  Держится:
  - список id разбирается без дублей и пустых элементов; не больше 100;
  - недоступные записи молча выпадают из ответа — ответ не сообщает, что они есть;
  - миниатюра отдаётся, только если лежит в хранилище, иначе — оригинал;
  - один неподписавшийся файл не роняет остальные;
  - если читать нечего, хранилище не поднимается.
*/
const h = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  mediaFindMany: vi.fn(),
  filterReadableMedia: vi.fn(),
  getSignedUrl: vi.fn(),
  send: vi.fn(),
  s3Created: vi.fn(),
}));

vi.mock('@/core/api-wrapper', () => ({withApi: (handler: unknown) => handler}));
vi.mock('@/lib/auth', () => ({requireAuth: h.requireAuth}));
vi.mock('@/lib/db', () => ({db: {media: {findMany: h.mediaFindMany}}}));
vi.mock('@/core/media/media-auth', () => ({filterReadableMedia: h.filterReadableMedia}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({getSignedUrl: h.getSignedUrl}));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { constructor() { h.s3Created(); } send = h.send; },
  GetObjectCommand: class { constructor(public input: {Key: string}) {} },
  HeadObjectCommand: class { constructor(public input: {Key: string}) {} },
}));

import {GET} from '../route';

type Handler = (request: NextRequest) => Promise<Response>;
const call = (query: string) => (GET as unknown as Handler)(new NextRequest(`http://localhost/api/media/download-batch${query}`));

const USER = {id: 'u-1', role: 'OPERATOR', tenantId: 'tenant-a'};
const row = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, key: `${id}.jpg`, thumbnailKey: `${id}-thumb.jpg`, entityType: 'report', entityId: 'R-1',
  isDeleted: false, uploadStatus: 'completed', userId: 'u-1', tenantId: 'tenant-a', ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.requireAuth.mockResolvedValue({user: USER, error: null});
  h.mediaFindMany.mockResolvedValue([row('a'), row('b')]);
  h.filterReadableMedia.mockImplementation((_actor: unknown, rows: unknown[]) => rows);
  h.getSignedUrl.mockImplementation(async (_s3: unknown, command: {input: {Key: string}}) => `https://s3.example/${command.input.Key}`);
  h.send.mockResolvedValue({});
});

describe('GET /api/media/download-batch', () => {
  it('без сессии ничего не читается', async () => {
    h.requireAuth.mockResolvedValue({user: null, error: new Response('{}', {status: 401})});

    expect((await call('?ids=a')).status).toBe(401);
    expect(h.mediaFindMany).not.toHaveBeenCalled();
  });

  it('пустой список — пустой ответ, база и хранилище не трогаются', async () => {
    expect(await (await call('')).json()).toEqual({urls: {}, expiresIn: 3600});
    expect(await (await call('?ids=, ,,')).json()).toEqual({urls: {}, expiresIn: 3600});
    expect(h.mediaFindMany).not.toHaveBeenCalled();
  });

  it('больше 100 идентификаторов — 400', async () => {
    const ids = Array.from({length: 101}, (_, index) => `m${index}`).join(',');

    expect((await call(`?ids=${ids}`)).status).toBe(400);
    expect(h.mediaFindMany).not.toHaveBeenCalled();
  });

  it('повторы и пробелы убираются до запроса в базу', async () => {
    await call('?ids= a ,b,a,,b');

    expect(h.mediaFindMany.mock.calls[0][0].where).toEqual({id: {in: ['a', 'b']}});
  });

  it('недоступные записи выпадают без следа, хранилище не поднимается, если читать нечего', async () => {
    h.filterReadableMedia.mockReturnValue([]);

    const response = await call('?ids=a,b');

    expect(await response.json()).toEqual({urls: {}, expiresIn: 3600});
    expect(h.filterReadableMedia).toHaveBeenCalledWith(USER, expect.any(Array));
    expect(h.s3Created).not.toHaveBeenCalled();
  });

  it('отдаёт ссылки только на то, что пропустил фильтр доступа', async () => {
    h.filterReadableMedia.mockImplementation((_actor: unknown, rows: Array<{id: string}>) => rows.filter((item) => item.id === 'a'));

    const body = await (await call('?ids=a,b')).json();

    expect(Object.keys(body.urls)).toEqual(['a']);
  });

  it('миниатюра есть — ссылка на неё; нет в хранилище — на оригинал', async () => {
    h.send.mockImplementation(async (command: {input: {Key: string}}) => {
      if (command.input.Key === 'b-thumb.jpg') throw new Error('NotFound');
      return {};
    });

    const body = await (await call('?ids=a,b&thumb=1')).json();

    expect(body.urls).toEqual({a: 'https://s3.example/a-thumb.jpg', b: 'https://s3.example/b.jpg'});
  });

  it('без thumb=1 хранилище не опрашивается, отдаются оригиналы', async () => {
    const body = await (await call('?ids=a,b')).json();

    expect(h.send).not.toHaveBeenCalled();
    expect(body.urls).toEqual({a: 'https://s3.example/a.jpg', b: 'https://s3.example/b.jpg'});
  });

  it('один неподписавшийся файл не роняет остальные', async () => {
    h.getSignedUrl.mockImplementation(async (_s3: unknown, command: {input: {Key: string}}) => {
      if (command.input.Key === 'a.jpg') throw new Error('sign failed');
      return `https://s3.example/${command.input.Key}`;
    });

    const body = await (await call('?ids=a,b')).json();

    expect(body.urls).toEqual({b: 'https://s3.example/b.jpg'});
  });
});
