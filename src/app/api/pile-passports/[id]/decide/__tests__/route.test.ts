/**
 * POST /api/pile-passports/[id]/decide — behavioural test of F-R34-16.
 *
 * Решение мастера по свае перезаписывает acceptance/acceptedById/acceptedAt —
 * те же колонки, что и у прежнего решения. Мастер принял сваю, потом отправил
 * её на добивку: без снимка «before» журнал аудита помнил бы только последнее
 * решение и последнего человека. Тесты держат три вещи: снимок читается до
 * перезаписи, в след попадает прежнее решение вместе с номером сваи, и на
 * отклонённом решении следа не остаётся.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, assertCanMock, decideMock, findFirstMock, recordAuditEventMock } = vi.hoisted(
  () => ({
    requireAuthMock: vi.fn(),
    assertCanMock: vi.fn(),
    decideMock: vi.fn(),
    findFirstMock: vi.fn(),
    recordAuditEventMock: vi.fn(),
  }),
);

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/services/auth/authorization-service', () => ({ assertCan: assertCanMock }));
vi.mock('@/services/audit/audit-service', () => ({ recordAuditEvent: recordAuditEventMock }));
vi.mock('@/modules/reports/application/queries/pile-passport.service', () => ({
  decidePilePassport: decideMock,
}));
vi.mock('@/lib/db', () => ({ db: { pilePassport: { findFirst: findFirstMock } } }));

import { POST } from '../route';
import { ServiceError } from '@/lib/service-error';

const foreman = { id: 'foreman-1', role: 'ADMIN', tenantId: 'tenant-a' };

/** Только те поля, что маршрут читает в снимок. */
const passport = {
  pileNumber: 'С-130',
  acceptance: 'ACCEPTED',
  acceptedById: 'foreman-1',
  acceptedAt: new Date('2026-09-20T08:00:00.000Z'),
  acceptanceNote: null,
};

const params = Promise.resolve({ id: 'p-1' });

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/pile-passports/p-1/decide', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockResolvedValue({ user: foreman, error: null });
  decideMock.mockResolvedValue(undefined);
  findFirstMock.mockResolvedValue(passport);
});

describe('POST /api/pile-passports/[id]/decide — след решения мастера', () => {
  it('читает прежнее решение по свае до перезаписи и в той же организации', async () => {
    await POST(req({ acceptance: 'NEEDS_REDRIVE', note: 'Не добита до проектного отказа' }), { params });

    expect(findFirstMock).toHaveBeenCalledWith({
      where: { id: 'p-1', tenantId: 'tenant-a' },
      select: {
        pileNumber: true,
        acceptance: true,
        acceptedById: true,
        acceptedAt: true,
        acceptanceNote: true,
      },
    });
    expect(findFirstMock.mock.invocationCallOrder[0]).toBeLessThan(decideMock.mock.invocationCallOrder[0]);
  });

  it('пишет pile.passport.decided с номером сваи и прежним/новым решением', async () => {
    const response = await POST(
      req({ acceptance: 'NEEDS_REDRIVE', note: '  Не добита до проектного отказа  ' }),
      { params },
    );

    expect(response.status).toBe(200);
    expect(recordAuditEventMock).toHaveBeenCalledWith({
      action: 'pile.passport.decided',
      scope: 'reports',
      actorId: 'foreman-1',
      targetId: 'p-1',
      tenantId: 'tenant-a',
      metadata: {
        pileNumber: 'С-130',
        before: {
          acceptance: 'ACCEPTED',
          acceptedById: 'foreman-1',
          acceptedAt: passport.acceptedAt,
          acceptanceNote: null,
        },
        after: {
          acceptance: 'NEEDS_REDRIVE',
          acceptedById: 'foreman-1',
          acceptanceNote: 'Не добита до проектного отказа',
        },
      },
    });
  });

  it('оставляет before пустым, когда паспорта в этой организации нет', async () => {
    findFirstMock.mockResolvedValue(null);

    await POST(req({ acceptance: 'ACCEPTED' }), { params });

    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ pileNumber: null, before: null }),
      }),
    );
  });

  it('не пишет след, когда решения по чужому/несуществующему паспорту не было', async () => {
    findFirstMock.mockResolvedValue(null);
    decideMock.mockRejectedValue(new ServiceError('Паспорт сваи не найден', 404));

    const response = await POST(req({ acceptance: 'ACCEPTED' }), { params });

    expect(response.status).toBe(404);
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it('не пишет след на отклонённые данные', async () => {
    const response = await POST(req({ acceptance: 'PENDING' }), { params });

    expect(response.status).toBe(400);
    expect(decideMock).not.toHaveBeenCalled();
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });
});
