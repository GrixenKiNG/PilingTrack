/**
 * DELETE /api/maintenance-plans/[id] — след удаления регламента ТО (F-R39-3).
 *
 * Удалённый регламент не оставлял ни строки, ни следа: разобрать, кто и когда
 * убрал правило, по которому планируется ТО, было нечем. Роут читает снимок
 * регламента ДО удаления и после успеха пишет `maintenance.plan.deleted` с
 * названием, интервалом и названием установки.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthMock,
  findFirstPlanMock,
  deleteMaintenancePlanMock,
  recordAuditEventMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  findFirstPlanMock: vi.fn(),
  deleteMaintenancePlanMock: vi.fn(),
  recordAuditEventMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/lib/db', () => ({ db: { maintenancePlan: { findFirst: findFirstPlanMock } } }));
vi.mock('@/modules/equipment', () => ({ deleteMaintenancePlan: deleteMaintenancePlanMock }));
vi.mock('@/services/audit/audit-service', () => ({ recordAuditEvent: recordAuditEventMock }));
vi.mock('@/lib/logger', () => ({
  logger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { DELETE } from '../route';

const ADMIN = { id: 'admin-1', name: 'Админ А.', role: 'ADMIN', tenantId: 'tenant-a' };

const PLAN_ROW = {
  title: 'ТО-2',
  type: 'TO2',
  triggerType: 'HOURS',
  intervalHours: 250,
  intervalDays: null,
  equipment: { name: 'ЭО-5111' },
};

function deleteReq(): NextRequest {
  return new NextRequest('http://localhost/api/maintenance-plans/plan-1', { method: 'DELETE' });
}

function params() {
  return { params: Promise.resolve({ id: 'plan-1' }) };
}

describe('DELETE /api/maintenance-plans/[id] — снимок и след (F-R39-3)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
    findFirstPlanMock.mockResolvedValue(PLAN_ROW);
    deleteMaintenancePlanMock.mockResolvedValue(undefined);
    recordAuditEventMock.mockResolvedValue(undefined);
  });

  it('читает регламент строго по тенанту и вперёд удаления', async () => {
    const res = await DELETE(deleteReq(), params());

    expect(res.status).toBe(200);
    expect(findFirstPlanMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'plan-1', tenantId: 'tenant-a' } }),
    );
    expect(findFirstPlanMock.mock.invocationCallOrder[0]).toBeLessThan(
      deleteMaintenancePlanMock.mock.invocationCallOrder[0],
    );
    expect(deleteMaintenancePlanMock).toHaveBeenCalledWith('plan-1', { tenantId: 'tenant-a' });
  });

  it('пишет maintenance.plan.deleted с названием, интервалом и установкой', async () => {
    await DELETE(deleteReq(), params());

    expect(recordAuditEventMock).toHaveBeenCalledTimes(1);
    expect(recordAuditEventMock).toHaveBeenCalledWith({
      action: 'maintenance.plan.deleted',
      scope: 'equipment',
      actorId: 'admin-1',
      targetId: 'plan-1',
      tenantId: 'tenant-a',
      metadata: {
        name: 'ЭО-5111',
        before: {
          title: 'ТО-2',
          type: 'TO2',
          triggerType: 'HOURS',
          intervalHours: 250,
          intervalDays: null,
        },
      },
    });
  });

  it('не пишет след, когда регламент не найден (404)', async () => {
    const { ServiceError } = await import('@/services/service-error');
    deleteMaintenancePlanMock.mockRejectedValue(new ServiceError('Регламент ТО не найден', 404));

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
