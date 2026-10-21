/**
 * PUT /api/inspections/[id] — версия осмотра в запросе.
 *
 * Набор ответов заменяется целиком, поэтому клиент, который прислал версию
 * (updatedAt) прочитанного осмотра, не должен затирать более свежие ответы
 * другого клиента (находка Codex XP42). Версия необязательна: клиенты, которые
 * её не шлют, работают как раньше.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { ServiceError } from '@/services/service-error';

const { requireAuthMock, saveMock, getMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  saveMock: vi.fn(),
  getMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/modules/inspections', () => ({ saveAnswers: saveMock, getInspection: getMock }));
vi.mock('@/modules/audit', () => ({ recordAuditEvent: vi.fn() }));

import { PUT } from '../[id]/route';

const answers = [{ itemId: 'i1', result: 'OK' }];
const ctx = { params: Promise.resolve({ id: 'ins-1' }) };

function put(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/inspections/ins-1', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PUT /api/inspections/[id]', () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    saveMock.mockReset();
    requireAuthMock.mockResolvedValue({ user: { id: 'a', role: 'ADMIN', tenantId: 'orion' }, error: null });
    saveMock.mockResolvedValue({ id: 'ins-1' });
  });

  it('передаёт версию осмотра из тела в saveAnswers', async () => {
    const res = await PUT(put({ answers, expectedUpdatedAt: '2026-10-01T09:00:00.000Z' }), ctx);

    expect(res.status).toBe(200);
    expect(saveMock).toHaveBeenCalledTimes(1);
    const expected = saveMock.mock.calls[0][3] as Date;
    expect(expected).toBeInstanceOf(Date);
    expect(expected.toISOString()).toBe('2026-10-01T09:00:00.000Z');
  });

  it('без версии вызывает saveAnswers как раньше', async () => {
    const res = await PUT(put({ answers }), ctx);

    expect(res.status).toBe(200);
    expect(saveMock.mock.calls[0][3]).toBeUndefined();
  });

  it('отклоняет версию, которая не является датой', async () => {
    const res = await PUT(put({ answers, expectedUpdatedAt: 'вчера' }), ctx);

    expect(res.status).toBe(400);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('отдаёт клиенту 409 при конфликте версии', async () => {
    saveMock.mockRejectedValue(new ServiceError('Осмотр изменён другим запросом. Обновите осмотр и повторите.', 409));

    const res = await PUT(put({ answers, expectedUpdatedAt: '2026-10-01T09:00:00.000Z' }), ctx);

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/изменён другим запросом/);
  });
});
