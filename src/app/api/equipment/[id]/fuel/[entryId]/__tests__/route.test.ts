/**
 * DELETE /api/equipment/[id]/fuel/[entryId] — след удаления записи о топливе (F-R39-3).
 *
 * Запись о заправке удаляется безвозвратно, и в спор о недостаче топлива её
 * потом не поднять: роут читает снимок ДО удаления и после успеха пишет событие
 * аудита `equipment.fuel.deleted` с литражом, датой и названием установки.
 * На 404 следа быть не должно, а сбой записи следа — не повод отдать 500 по уже
 * выполненному удалению.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthMock,
  findFirstFuelMock,
  deleteFuelEntryMock,
  recordAuditEventMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  findFirstFuelMock: vi.fn(),
  deleteFuelEntryMock: vi.fn(),
  recordAuditEventMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/lib/db', () => ({ db: { fuelLog: { findFirst: findFirstFuelMock } } }));
vi.mock('@/modules/equipment', () => ({ deleteFuelEntry: deleteFuelEntryMock }));
vi.mock('@/services/audit/audit-service', () => ({ recordAuditEvent: recordAuditEventMock }));
vi.mock('@/lib/logger', () => ({
  logger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { DELETE } from '../route';

const ADMIN = { id: 'admin-1', name: 'Админ А.', role: 'ADMIN', tenantId: 'tenant-a' };

const FUEL_ROW = {
  litersAdded: 120,
  recordedAt: new Date('2026-09-26T08:00:00.000Z'),
  source: 'MANUAL',
  equipment: { name: 'ЭО-5111' },
};

function deleteReq(): NextRequest {
  return new NextRequest('http://localhost/api/equipment/eq-1/fuel/fl-1', { method: 'DELETE' });
}

function params() {
  return { params: Promise.resolve({ id: 'eq-1', entryId: 'fl-1' }) };
}

describe('DELETE /api/equipment/[id]/fuel/[entryId] — снимок и след (F-R39-3)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
    findFirstFuelMock.mockResolvedValue(FUEL_ROW);
    deleteFuelEntryMock.mockResolvedValue(undefined);
    recordAuditEventMock.mockResolvedValue(undefined);
  });

  it('читает запись строго по тенанту и вперёд удаления', async () => {
    const res = await DELETE(deleteReq(), params());

    expect(res.status).toBe(200);
    expect(findFirstFuelMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'fl-1', equipmentId: 'eq-1', tenantId: 'tenant-a' } }),
    );
    expect(findFirstFuelMock.mock.invocationCallOrder[0]).toBeLessThan(
      deleteFuelEntryMock.mock.invocationCallOrder[0],
    );
    expect(deleteFuelEntryMock).toHaveBeenCalledWith('eq-1', 'fl-1', { tenantId: 'tenant-a' });
  });

  it('пишет equipment.fuel.deleted с литражом, датой и названием установки', async () => {
    await DELETE(deleteReq(), params());

    expect(recordAuditEventMock).toHaveBeenCalledTimes(1);
    expect(recordAuditEventMock).toHaveBeenCalledWith({
      action: 'equipment.fuel.deleted',
      scope: 'equipment',
      actorId: 'admin-1',
      targetId: 'fl-1',
      tenantId: 'tenant-a',
      metadata: {
        name: 'ЭО-5111',
        before: {
          litersAdded: 120,
          recordedAt: FUEL_ROW.recordedAt,
          source: 'MANUAL',
        },
      },
    });
  });

  it('не пишет след, когда запись не найдена (404)', async () => {
    const { ServiceError } = await import('@/services/service-error');
    deleteFuelEntryMock.mockRejectedValue(new ServiceError('Запись о топливе не найдена', 404));

    const res = await DELETE(deleteReq(), params());

    expect(res.status).toBe(404);
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it('остаётся успешным, когда запись следа упала', async () => {
    recordAuditEventMock.mockRejectedValue(new Error('feed down'));

    const res = await DELETE(deleteReq(), params());

    expect(res.status).toBe(200);
    expect(loggerErrorMock).toHaveBeenCalled();
  });
});
