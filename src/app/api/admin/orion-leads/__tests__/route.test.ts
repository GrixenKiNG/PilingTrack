/**
 * GET /api/admin/orion-leads — заявки с сайта, не дошедшие в Telegram. Заявка
 * сохраняется до отправки, и без этого списка про сбой бота не узнать.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { ServiceError } from '@/lib/service-error';

const { requireAuthMock, assertCanMock, findManyMock, countMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  assertCanMock: vi.fn(),
  findManyMock: vi.fn(),
  countMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/services/auth/authorization-service', () => ({ assertCan: assertCanMock }));
vi.mock('@/lib/db', () => ({ db: { orionLead: { findMany: findManyMock, count: countMock } } }));

import { GET } from '../route';

const ADMIN = { id: 'admin-1', name: 'Админ А.', role: 'ADMIN', tenantId: 'tenant-a' };

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/orion-leads${qs}`);

describe('GET /api/admin/orion-leads', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
    findManyMock.mockResolvedValue([]);
    countMock.mockResolvedValue(0);
  });

  it('отдаёт только недоставленные не-спам заявки своей организации', async () => {
    const lead = {
      id: 'l1', name: 'Иван', contact: '+7 900 000-00-00', message: 'Нужны сваи',
      deliveryError: 'Telegram не принял сообщение или бот не настроен',
      createdAt: new Date('2026-10-13T09:00:00.000Z'),
    };
    findManyMock.mockResolvedValue([lead]);
    countMock.mockResolvedValue(1);

    const res = await GET(req());

    expect(res.status).toBe(200);
    const where = { tenantId: 'tenant-a', deliveredAt: null, isSpam: false };
    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where, orderBy: { createdAt: 'desc' }, take: 100,
    }));
    expect(countMock).toHaveBeenCalledWith({ where });
    expect(assertCanMock).toHaveBeenCalledWith(ADMIN, 'dlq.manage');
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.leads[0]).toMatchObject({ id: 'l1', deliveryError: lead.deliveryError });
  });

  it.each([
    ['limit=50', 50],
    ['limit=100000', 200],
    ['limit=0', 100],
    ['limit=-5', 100],
    ['limit=abc', 100],
  ])('ограничивает выборку: %s → %i', async (qs, expected) => {
    await GET(req(`?${qs}`));
    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({ take: expected }));
  });

  it('не ходит в базу без входа', async () => {
    requireAuthMock.mockResolvedValue({
      user: null,
      error: NextResponse.json({ error: 'Требуется вход' }, { status: 401 }),
    });

    const res = await GET(req());

    expect(res.status).toBe(401);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('отказывает без права dlq.manage и не читает заявки', async () => {
    assertCanMock.mockImplementation(() => {
      throw new ServiceError('Доступ запрещён', 403);
    });

    const res = await GET(req());

    expect(res.status).toBe(403);
    expect(findManyMock).not.toHaveBeenCalled();
  });
});
