/**
 * POST /api/maintenance/[id]/accept — след приёмки наряда ТО (F-R34-12).
 *
 * Приёмка закрывает наряд в обход правки, а в журнале об этом не оставалось
 * ничего: кто принял работы и когда, видно было только по колонкам
 * acceptedById/acceptedAt самой строки. Роут пишет `maintenance.accepted` с
 * названием наряда после успешной приёмки — и не роняет её, если запись следа
 * сорвалась.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, acceptMaintenanceMock, recordAuditEventMock, loggerErrorMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  acceptMaintenanceMock: vi.fn(),
  recordAuditEventMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/modules/equipment', () => ({ acceptMaintenance: acceptMaintenanceMock }));
vi.mock('@/services/audit/audit-service', () => ({ recordAuditEvent: recordAuditEventMock }));
vi.mock('@/lib/logger', () => ({
  logger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { POST } from '../route';

const ADMIN = { id: 'admin-1', name: 'Админ А.', role: 'ADMIN', tenantId: 'tenant-a' };

function acceptReq(): NextRequest {
  return new NextRequest('http://localhost/api/maintenance/rec-1/accept', { method: 'POST' });
}

function params() {
  return { params: Promise.resolve({ id: 'rec-1' }) };
}

describe('POST /api/maintenance/[id]/accept — след приёмки (F-R34-12)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
    acceptMaintenanceMock.mockResolvedValue({ id: 'rec-1', title: 'Замена РВД', status: 'DONE' });
    recordAuditEventMock.mockResolvedValue(undefined);
  });

  it('пишет maintenance.accepted с названием наряда и актором', async () => {
    const res = await POST(acceptReq(), params());

    expect(res.status).toBe(200);
    expect(acceptMaintenanceMock).toHaveBeenCalledWith('rec-1', { tenantId: 'tenant-a', userId: 'admin-1' });
    expect(recordAuditEventMock).toHaveBeenCalledWith({
      action: 'maintenance.accepted',
      scope: 'equipment',
      actorId: 'admin-1',
      targetId: 'rec-1',
      tenantId: 'tenant-a',
      metadata: { name: 'Замена РВД' },
    });
  });

  it('не пишет след, когда приёмка отклонена (409)', async () => {
    const { ServiceError } = await import('@/services/service-error');
    acceptMaintenanceMock.mockRejectedValue(new ServiceError('Запись уже принята', 409));

    const res = await POST(acceptReq(), params());

    expect(res.status).toBe(409);
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it('остаётся успешным, когда запись следа упала', async () => {
    recordAuditEventMock.mockRejectedValue(new Error('feed down'));

    const res = await POST(acceptReq(), params());

    expect(res.status).toBe(200);
    expect(loggerErrorMock).toHaveBeenCalled();
  });
});
