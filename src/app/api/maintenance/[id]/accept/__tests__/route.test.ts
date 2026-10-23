/**
 * POST /api/maintenance/[id]/accept — приёмка наряда ТО (F-R34-12).
 *
 * След `maintenance.accepted` пишет сама команда `acceptMaintenance` в одной
 * транзакции с приёмкой (проверяется в equipment-maintenance.test.ts); маршрут
 * только передаёт ей организацию и актора и отдаёт её отказы как есть.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, acceptMaintenanceMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  acceptMaintenanceMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/modules/equipment', () => ({ acceptMaintenance: acceptMaintenanceMock }));

import { POST } from '../route';

const ADMIN = { id: 'admin-1', name: 'Админ А.', role: 'ADMIN', tenantId: 'tenant-a' };

function acceptReq(): NextRequest {
  return new NextRequest('http://localhost/api/maintenance/rec-1/accept', { method: 'POST' });
}

function params() {
  return { params: Promise.resolve({ id: 'rec-1' }) };
}

describe('POST /api/maintenance/[id]/accept', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
    acceptMaintenanceMock.mockResolvedValue({ id: 'rec-1', title: 'Замена РВД', status: 'DONE' });
  });

  it('передаёт команде организацию и актора и отдаёт принятую запись', async () => {
    const res = await POST(acceptReq(), params());

    expect(res.status).toBe(200);
    expect(acceptMaintenanceMock).toHaveBeenCalledWith('rec-1', { tenantId: 'tenant-a', userId: 'admin-1' });
    expect((await res.json()).record).toMatchObject({ id: 'rec-1', status: 'DONE' });
  });

  it('отказ команды (409) отдаёт как есть', async () => {
    const { ServiceError } = await import('@/services/service-error');
    acceptMaintenanceMock.mockRejectedValue(new ServiceError('Запись уже принята', 409));

    const res = await POST(acceptReq(), params());

    expect(res.status).toBe(409);
  });

  it('сбой команды (в том числе записи следа) — ошибка, а не «успех»', async () => {
    acceptMaintenanceMock.mockRejectedValue(new Error('след не записан'));

    // Общая обёртка превращает непредвиденную ошибку в 500 — приёмка не «прошла».
    const res = await POST(acceptReq(), params());

    expect(res.status).toBe(500);
  });
});
