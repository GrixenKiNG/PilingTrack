/**
 * POST /api/equipment/[id]/maintenance — след заведения наряда ТО (F-R34-12).
 *
 * Заведение наряда не оставляло в журнале ни строки: разобрать, кто и когда
 * завёл работу, было нечем. Роут пишет `maintenance.created` с названием и
 * видом наряда после успешного создания — и не роняет его, если запись следа
 * сорвалась.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, createMaintenanceMock, recordAuditEventMock, loggerErrorMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  createMaintenanceMock: vi.fn(),
  recordAuditEventMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/modules/equipment', () => ({
  createMaintenance: createMaintenanceMock,
  listMaintenance: vi.fn(),
}));
vi.mock('@/services/audit/audit-service', () => ({ recordAuditEvent: recordAuditEventMock }));
vi.mock('@/lib/logger', () => ({
  logger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { POST } from '../route';

const ADMIN = { id: 'admin-1', name: 'Админ А.', role: 'ADMIN', tenantId: 'tenant-a' };

function createReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/equipment/eq-1/maintenance', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function params() {
  return { params: Promise.resolve({ id: 'eq-1' }) };
}

describe('POST /api/equipment/[id]/maintenance — след создания (F-R34-12)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
    createMaintenanceMock.mockResolvedValue({
      id: 'rec-1',
      title: 'Замена РВД',
      type: 'REPAIR',
      status: 'PLANNED',
    });
    recordAuditEventMock.mockResolvedValue(undefined);
  });

  it('пишет maintenance.created с названием, видом и статусом наряда', async () => {
    const res = await POST(createReq({ type: 'REPAIR', title: 'Замена РВД' }), params());

    expect(res.status).toBe(201);
    expect(createMaintenanceMock).toHaveBeenCalledWith(
      'eq-1',
      expect.objectContaining({ type: 'REPAIR', title: 'Замена РВД' }),
      { tenantId: 'tenant-a', createdById: 'admin-1' },
    );
    expect(recordAuditEventMock).toHaveBeenCalledWith({
      action: 'maintenance.created',
      scope: 'equipment',
      actorId: 'admin-1',
      targetId: 'rec-1',
      tenantId: 'tenant-a',
      metadata: { name: 'Замена РВД', after: { type: 'REPAIR', status: 'PLANNED' } },
    });
  });

  it('не пишет след на некорректных данных (400)', async () => {
    const res = await POST(createReq({ type: 'REPAIR' }), params());

    expect(res.status).toBe(400);
    expect(createMaintenanceMock).not.toHaveBeenCalled();
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it('не пишет след, когда установка не найдена (404)', async () => {
    const { ServiceError } = await import('@/services/service-error');
    createMaintenanceMock.mockRejectedValue(new ServiceError('Установка не найдена', 404));

    const res = await POST(createReq({ type: 'REPAIR', title: 'x' }), params());

    expect(res.status).toBe(404);
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it('остаётся успешным, когда запись следа упала', async () => {
    recordAuditEventMock.mockRejectedValue(new Error('feed down'));

    const res = await POST(createReq({ type: 'REPAIR', title: 'Замена РВД' }), params());

    expect(res.status).toBe(201);
    expect(loggerErrorMock).toHaveBeenCalled();
  });
});
