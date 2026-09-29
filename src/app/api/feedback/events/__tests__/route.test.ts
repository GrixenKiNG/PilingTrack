/**
 * GET /api/feedback/events — лента обратной связи не тонет во входах (F-FEED-LOGIN).
 *
 * «Успешный вход» пишется на каждое открытие сессии и вытеснял рабочие события
 * из списка на 25 строк. Роут читает ленту через feedback-event-service, поэтому
 * здесь проверяем реальную выборку: фильтр должен отсекать auth.login.succeeded,
 * но оставлять auth.login.failed — и по тому же фильтру считать непрочитанные
 * (бейдж) и отмечать их прочитанными (read_all).
 */
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {NextRequest} from 'next/server';

const {requireAuthMock, findManyMock, upsertMock} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  findManyMock: vi.fn(),
  upsertMock: vi.fn(),
}));

// Маршруты оборачивают обработчик в withApi/withMutation. Проверяем сам
// обработчик: обёртки возвращаем как есть, чтобы не поднимать весь стек
// (Sentry, rate limiter, метрики, кеш).
vi.mock('@/core/api-wrapper', () => ({
  withApi: (handler: unknown) => handler,
  withMutation: (handler: unknown) => handler,
  getSessionCacheScope: () => undefined,
}));

vi.mock('@/core/cache', () => ({
  getResponseCache: () => ({invalidate: vi.fn()}),
}));

vi.mock('@/lib/auth', () => ({requireAuth: requireAuthMock}));

vi.mock('@/lib/db', () => ({
  db: {
    feedbackEvent: {findMany: findManyMock},
    feedbackEventRead: {upsert: upsertMock},
  },
}));

import {GET, POST} from '../route';

const ADMIN = {id: 'admin-1', name: 'Админ А.', role: 'ADMIN'};

function row(action: string, id: string, unread = true) {
  return {
    id,
    level: 'success',
    priority: 'LOW',
    scope: 'auth',
    action,
    title: action,
    message: action,
    audience: 'OPERATIONS',
    actorId: 'admin-1',
    actorName: 'Админ А.',
    actorRole: 'ADMIN',
    targetId: null,
    requestId: `req-${id}`,
    metadata: null,
    createdAt: new Date('2026-09-28T10:00:00.000Z'),
    reads: unread ? [] : [{readAt: new Date('2026-09-28T11:00:00.000Z'), acknowledgedAt: null}],
  };
}

const ALL_ROWS = [
  row('auth.login.succeeded', 's1'),
  row('auth.login.succeeded', 's2'),
  row('auth.login.failed', 'f1'),
  row('ReportSubmitted', 'r1', false),
];

function req(): NextRequest {
  return new NextRequest('http://localhost/api/feedback/events');
}

function readAllRequest(): NextRequest {
  return new NextRequest('http://localhost/api/feedback/events', {
    method: 'POST',
    body: JSON.stringify({operation: 'read_all'}),
  });
}

describe('GET /api/feedback/events — фильтр ленты (F-FEED-LOGIN)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({user: ADMIN, error: null});
    // Эмулируем выборку как в базе: `action.notIn` действительно отсекает строки,
    // поэтому тест падает, если фильтр из сервиса убрать.
    findManyMock.mockImplementation(async ({where}: {where?: {action?: {notIn?: string[]}}}) => {
      const hidden = where?.action?.notIn ?? [];
      return ALL_ROWS.filter((event) => !hidden.includes(event.action));
    });
    upsertMock.mockResolvedValue({});
  });

  it('не показывает в ленте auth.login.succeeded', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);

    const body = await res.json();
    const actions = body.events.map((event: {action: string}) => event.action);
    expect(actions).not.toContain('auth.login.succeeded');
    expect(body.summary.total).toBe(2);
  });

  it('оставляет в ленте auth.login.failed', async () => {
    const res = await GET(req());

    const body = await res.json();
    const actions = body.events.map((event: {action: string}) => event.action);
    expect(actions).toContain('auth.login.failed');
  });

  it('не считает auth.login.succeeded непрочитанным (бейдж)', async () => {
    const res = await GET(req());

    const body = await res.json();
    // Непрочитанные: два скрытых входа + auth.login.failed; в счётчик попадает только видимый.
    expect(body.summary.unread).toBe(1);
  });

  it('read_all отмечает прочитанным только то, что видно в ленте', async () => {
    const res = await POST(readAllRequest());
    expect(res.status).toBe(200);

    const markedIds = upsertMock.mock.calls.map(
      ([arg]) => (arg as {where: {eventId_userId: {eventId: string}}}).where.eventId_userId.eventId
    );
    expect(markedIds).toContain('f1');
    expect(markedIds).not.toContain('s1');
    expect(markedIds).not.toContain('s2');
  });

  it('returns 401 when there is no session', async () => {
    requireAuthMock.mockResolvedValue({user: null, error: null});

    const res = await GET(req());
    expect(res.status).toBe(401);
  });
});
