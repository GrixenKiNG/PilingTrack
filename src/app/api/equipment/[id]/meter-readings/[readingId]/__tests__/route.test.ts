/**
 * DELETE /api/equipment/[id]/meter-readings/[readingId] — след удаления (F-R34-13).
 *
 * Удаление показания моточасов меняет Equipment.engineHoursTotal и сроки ТО,
 * но самой строки показания после удаления нет: кто стёр и какую цифру —
 * восстановить нечем. Роут читает снимок показания ДО удаления и после успеха
 * пишет событие аудита `meter.reading.deleted` с названием установки, снятым
 * значением и автором показания. Запись нужна ровно тогда, когда удаление
 * состоялось: на 404 следа быть не должно.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthMock,
  findFirstReadingMock,
  deleteMeterReadingMock,
  recordAuditEventMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  findFirstReadingMock: vi.fn(),
  deleteMeterReadingMock: vi.fn(),
  recordAuditEventMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/lib/db', () => ({
  db: { meterReading: { findFirst: findFirstReadingMock } },
}));
vi.mock('@/modules/equipment', () => ({ deleteMeterReading: deleteMeterReadingMock }));
vi.mock('@/services/audit/audit-service', () => ({ recordAuditEvent: recordAuditEventMock }));

import { DELETE } from '../route';

const ADMIN = { id: 'admin-1', name: 'Админ А.', role: 'ADMIN', tenantId: 'tenant-a' };

const READING_ROW = {
  engineHours: 1234,
  recordedAt: new Date('2026-09-26T08:00:00.000Z'),
  recordedById: 'operator-1',
  equipment: { name: 'ЭО-5111' },
};

function deleteReq(): NextRequest {
  return new NextRequest('http://localhost/api/equipment/eq-1/meter-readings/rd-1', {
    method: 'DELETE',
  });
}

function params() {
  return { params: Promise.resolve({ id: 'eq-1', readingId: 'rd-1' }) };
}

describe('DELETE /api/equipment/[id]/meter-readings/[readingId] — снимок и след (F-R34-13)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
    findFirstReadingMock.mockResolvedValue(READING_ROW);
    deleteMeterReadingMock.mockResolvedValue(undefined);
    recordAuditEventMock.mockResolvedValue(undefined);
  });

  it('читает показание строго по тенанту и удаляет его', async () => {
    const res = await DELETE(deleteReq(), params());

    expect(res.status).toBe(200);
    expect(findFirstReadingMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'rd-1', equipmentId: 'eq-1', tenantId: 'tenant-a' } }),
    );
    expect(deleteMeterReadingMock).toHaveBeenCalledWith('eq-1', 'rd-1', { tenantId: 'tenant-a' });
  });

  it('пишет meter.reading.deleted со снимком показания и актором после успеха', async () => {
    await DELETE(deleteReq(), params());

    expect(recordAuditEventMock).toHaveBeenCalledTimes(1);
    expect(recordAuditEventMock).toHaveBeenCalledWith({
      action: 'meter.reading.deleted',
      scope: 'equipment',
      actorId: 'admin-1',
      targetId: 'rd-1',
      tenantId: 'tenant-a',
      metadata: {
        name: 'ЭО-5111',
        before: {
          engineHours: 1234,
          recordedAt: READING_ROW.recordedAt,
          recordedById: 'operator-1',
        },
      },
    });
  });

  it('не пишет след, когда показание не найдено (404)', async () => {
    const { ServiceError } = await import('@/services/service-error');
    deleteMeterReadingMock.mockRejectedValue(new ServiceError('Показание моточасов не найдено', 404));

    const res = await DELETE(deleteReq(), params());

    expect(res.status).toBe(404);
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it('не теряет событие, когда снимок не прочитан заранее', async () => {
    findFirstReadingMock.mockResolvedValue(null);

    const res = await DELETE(deleteReq(), params());

    expect(res.status).toBe(200);
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'meter.reading.deleted', metadata: undefined }),
    );
  });
});
