/**
 * PUT /api/equipment/[id]/maintenance/[recordId] — след правки наряда ТО
 * (F-R34-12).
 *
 * Правка стоимости, трудозатрат и моточасов после закрытия наряда не оставляла
 * ничего: строка хранит только последнее значение, а принятый наряд вообще
 * закрыт на изменение. Роут читает снимок ДО правки (строго по тенанту и
 * установке) и после успеха пишет `maintenance.updated` со снимками before/after.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthMock,
  findFirstMock,
  equipmentFindFirstMock,
  updateMaintenanceMock,
  deleteMaintenanceMock,
  recordAuditEventMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  findFirstMock: vi.fn(),
  equipmentFindFirstMock: vi.fn(),
  updateMaintenanceMock: vi.fn(),
  deleteMaintenanceMock: vi.fn(),
  recordAuditEventMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/lib/db', () => ({
  db: {
    maintenanceRecord: { findFirst: findFirstMock },
    equipment: { findFirst: equipmentFindFirstMock },
  },
}));
vi.mock('@/modules/equipment', () => ({
  updateMaintenance: updateMaintenanceMock,
  deleteMaintenance: deleteMaintenanceMock,
}));
vi.mock('@/services/audit/audit-service', () => ({ recordAuditEvent: recordAuditEventMock }));
vi.mock('@/lib/logger', () => ({
  logger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { PUT, DELETE } from '../route';

const ADMIN = { id: 'admin-1', name: 'Админ А.', role: 'ADMIN', tenantId: 'tenant-a' };

const SNAPSHOT = {
  status: 'IN_PROGRESS',
  cost: 100,
  laborHours: 2,
  engineHoursAtService: 1200,
  workDone: '',
  cancelReason: null,
};

const UPDATED = {
  id: 'rec-1',
  title: 'Замена РВД',
  status: 'DONE',
  cost: 150,
  laborHours: 3,
  engineHoursAtService: 1234,
  workDone: 'заменили РВД',
  cancelReason: null,
};

function updateReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/equipment/eq-1/maintenance/rec-1', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function params() {
  return { params: Promise.resolve({ id: 'eq-1', recordId: 'rec-1' }) };
}

describe('PUT /api/equipment/[id]/maintenance/[recordId] — след правки (F-R34-12)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
    findFirstMock.mockResolvedValue(SNAPSHOT);
    updateMaintenanceMock.mockResolvedValue(UPDATED);
    recordAuditEventMock.mockResolvedValue(undefined);
  });

  it('читает снимок по тенанту и установке вперёд правки', async () => {
    const res = await PUT(updateReq({ status: 'DONE', workDone: 'заменили РВД' }), params());

    expect(res.status).toBe(200);
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { id: 'rec-1', equipmentId: 'eq-1', tenantId: 'tenant-a' },
      select: {
        status: true,
        cost: true,
        laborHours: true,
        engineHoursAtService: true,
        workDone: true,
        cancelReason: true,
      },
    });
    expect(findFirstMock.mock.invocationCallOrder[0]).toBeLessThan(
      updateMaintenanceMock.mock.invocationCallOrder[0],
    );
  });

  it('пишет maintenance.updated со снимками before/after', async () => {
    await PUT(updateReq({ status: 'DONE', workDone: 'заменили РВД' }), params());

    expect(recordAuditEventMock).toHaveBeenCalledWith({
      action: 'maintenance.updated',
      scope: 'equipment',
      actorId: 'admin-1',
      targetId: 'rec-1',
      tenantId: 'tenant-a',
      metadata: {
        name: 'Замена РВД',
        before: SNAPSHOT,
        after: {
          status: 'DONE',
          cost: 150,
          laborHours: 3,
          engineHoursAtService: 1234,
          workDone: 'заменили РВД',
          cancelReason: null,
        },
      },
    });
  });

  it('не пишет след, когда правка отклонена (409)', async () => {
    const { ServiceError } = await import('@/services/service-error');
    updateMaintenanceMock.mockRejectedValue(new ServiceError('Запись уже принята, изменения недоступны', 409));

    const res = await PUT(updateReq({ cost: 999 }), params());

    expect(res.status).toBe(409);
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it('остаётся успешным, когда запись следа упала', async () => {
    recordAuditEventMock.mockRejectedValue(new Error('feed down'));

    const res = await PUT(updateReq({ cost: 999 }), params());

    expect(res.status).toBe(200);
    expect(loggerErrorMock).toHaveBeenCalled();
  });
});

/**
 * DELETE /api/equipment/[id]/maintenance/[recordId] — след удаления наряда ТО
 * (F-R72-FEED-METER-MAINT).
 *
 * Удаление наряда не оставляло следа нигде, хотя создание, правка и приёмка
 * того же наряда писались. Удалить можно и открытый наряд, который держит
 * блокер по ремонту, поэтому роут берёт снимок из результата команды
 * (`delete` возвращает снятую строку — F-R72-FEED-b) и после успеха пишет
 * `maintenance.record.deleted`. Название установки читается отдельно.
 */
const REMOVED = {
  id: 'rec-1',
  title: 'Замена РВД',
  type: 'REPAIR',
  status: 'IN_PROGRESS',
  scheduledAt: new Date('2026-10-01T00:00:00.000Z'),
};

function deleteReq(): NextRequest {
  return new NextRequest('http://localhost/api/equipment/eq-1/maintenance/rec-1', {
    method: 'DELETE',
  });
}

describe('DELETE /api/equipment/[id]/maintenance/[recordId] — след удаления (F-R72-FEED-METER-MAINT)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
    deleteMaintenanceMock.mockResolvedValue(REMOVED);
    equipmentFindFirstMock.mockResolvedValue({ name: 'ЭО-5111' });
    recordAuditEventMock.mockResolvedValue(undefined);
  });

  it('берёт снимок из результата команды, не читая наряд заранее', async () => {
    const res = await DELETE(deleteReq(), params());

    expect(res.status).toBe(200);
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(equipmentFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'eq-1', tenantId: 'tenant-a' },
      select: { name: true },
    });
  });

  it('пишет maintenance.record.deleted со снимком из результата команды', async () => {
    await DELETE(deleteReq(), params());

    expect(recordAuditEventMock).toHaveBeenCalledTimes(1);
    expect(recordAuditEventMock).toHaveBeenCalledWith({
      action: 'maintenance.record.deleted',
      scope: 'equipment',
      actorId: 'admin-1',
      targetId: 'rec-1',
      tenantId: 'tenant-a',
      metadata: {
        name: 'Замена РВД',
        before: {
          type: 'REPAIR',
          status: 'IN_PROGRESS',
          scheduledAt: REMOVED.scheduledAt,
          equipmentName: 'ЭО-5111',
        },
      },
    });
  });

  it('не пишет след, когда наряд не найден (404)', async () => {
    const { ServiceError } = await import('@/services/service-error');
    deleteMaintenanceMock.mockRejectedValue(new ServiceError('Наряд ТО не найден', 404));

    const res = await DELETE(deleteReq(), params());

    expect(res.status).toBe(404);
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it('пишет событие без названия установки, когда её не нашли', async () => {
    equipmentFindFirstMock.mockResolvedValue(null);

    const res = await DELETE(deleteReq(), params());

    expect(res.status).toBe(200);
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'maintenance.record.deleted',
        metadata: expect.objectContaining({ name: 'Замена РВД', before: expect.objectContaining({ equipmentName: undefined }) }),
      }),
    );
  });
});
