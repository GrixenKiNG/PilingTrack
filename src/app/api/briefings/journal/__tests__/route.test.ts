// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';

/*
  Журнал инструктажей: выборка инженера ОТ и диспетчера.

  Права не подменяем. Держится:
  - читать журнал вправе те, у кого есть `users.documents.read_all`; решение
    принимает маршрут и передаёт модулю как флаг;
  - мусор в фильтре — ошибка 400, а не «показать всё»: молча расширенная выборка
    выглядит как ответ на заданный вопрос;
  - организация — из сессии.
*/
const h = vi.hoisted(() => ({requireAuth: vi.fn(), listBriefingJournal: vi.fn()}));

vi.mock('@/core/api-wrapper', () => ({withApi: (handler: unknown) => handler}));
vi.mock('@/lib/auth', () => ({requireAuth: h.requireAuth}));
vi.mock('@/modules/operator-mobile', () => ({listBriefingJournal: h.listBriefingJournal}));

import {ServiceError} from '@/lib/service-error';
import {GET} from '../route';

type Handler = (request: NextRequest) => Promise<Response>;
const get = (query = '') => (GET as unknown as Handler)(new NextRequest(`http://localhost/api/briefings/journal${query}`));
const as = (role: string) => ({id: 'u-1', name: 'Имя', role, tenantId: 'tenant-a'});

beforeEach(() => {
  vi.clearAllMocks();
  h.requireAuth.mockResolvedValue({user: as('SAFETY_ENGINEER'), error: null});
  h.listBriefingJournal.mockResolvedValue({rows: []});
});

describe('GET /api/briefings/journal', () => {
  it('без сессии журнал не читается', async () => {
    h.requireAuth.mockResolvedValue({user: null, error: new Response('{}', {status: 401})});

    expect((await get()).status).toBe(401);
    expect(h.listBriefingJournal).not.toHaveBeenCalled();
  });

  it.each([
    ['ADMIN', true], ['DISPATCHER', true], ['SAFETY_ENGINEER', true],
    ['OPERATOR', false], ['MECHANIC', false], ['FOREMAN', false], ['ASSISTANT', false],
  ])('право читать все записи у роли %s: %s (решает модуль по флагу)', async (role, allowed) => {
    h.requireAuth.mockResolvedValue({user: as(role), error: null});

    await get();

    expect(h.listBriefingJournal.mock.calls[0][0]).toMatchObject({tenantId: 'tenant-a', mayReadAllDocuments: allowed});
  });

  it('фильтры разбираются и передаются модулю', async () => {
    await get('?kind=KNOWLEDGE&type=REPEAT&status=awaiting&userId=w-1&instructorId=i-1&from=2026-10-01&to=2026-10-31');

    expect(h.listBriefingJournal.mock.calls[0][0].filters).toEqual({
      from: new Date('2026-10-01'), to: new Date('2026-10-31'),
      userId: 'w-1', kind: 'KNOWLEDGE', type: 'REPEAT', instructorId: 'i-1', status: 'awaiting',
    });
  });

  it('без фильтров модулю уходят пустые значения, а не пустые строки', async () => {
    await get();

    const filters = h.listBriefingJournal.mock.calls[0][0].filters;
    expect(Object.values(filters).every((value) => value === undefined)).toBe(true);
  });

  it.each([
    ['вид записи', '?kind=OTHER', 'вид записи'],
    ['вид инструктажа', '?type=WEEKLY', 'вид инструктажа'],
    ['статус', '?status=maybe', 'статус'],
  ])('мусор в фильтре «%s» — 400, а не полная выборка', async (_name, query, text) => {
    const response = await get(query);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(text);
    expect(h.listBriefingJournal).not.toHaveBeenCalled();
  });

  it('неверная дата в периоде — 400 с названием границы', async () => {
    const response = await get('?from=вчера');

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('from');
    expect(h.listBriefingJournal).not.toHaveBeenCalled();
  });

  it('отказ модуля сохраняет код, неожиданная ошибка пробрасывается', async () => {
    h.listBriefingJournal.mockRejectedValueOnce(new ServiceError('Нет доступа', 403));
    expect((await get()).status).toBe(403);

    h.listBriefingJournal.mockRejectedValueOnce(new Error('сбой'));
    await expect(get()).rejects.toThrow('сбой');
  });

  it('пользователь без организации получает отказ до чтения', async () => {
    h.requireAuth.mockResolvedValue({user: {...as('ADMIN'), tenantId: null}, error: null});

    await expect(get()).rejects.toMatchObject({status: 403});
    expect(h.listBriefingJournal).not.toHaveBeenCalled();
  });
});
