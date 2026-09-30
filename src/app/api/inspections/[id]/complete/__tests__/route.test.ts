/**
 * POST /api/inspections/[id]/complete — след завершения осмотра (F-R72-FEED-INSPECTION).
 *
 * Завершение осмотра — акт допуска: считается балл состояния, закрывается наряд
 * ТО, пишутся моточасы и заводятся дефекты, а следа в ленте не было вовсе.
 * После успешной команды роут пишет событие `inspection.completed` с названием
 * установки, уровнем осмотра, итоговым баллом и числом заведённых дефектов —
 * команда их не возвращает, поэтому они читаются отдельно, строго по тенанту.
 * Запись нужна ровно тогда, когда осмотр завершён: при ошибке команды следа
 * быть не должно.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { ServiceError } from '@/services/service-error';

const {
  requireAuthMock,
  completeInspectionMock,
  recordAuditEventMock,
  equipmentFindFirstMock,
  defectCountMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  completeInspectionMock: vi.fn(),
  recordAuditEventMock: vi.fn(),
  equipmentFindFirstMock: vi.fn(),
  defectCountMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/lib/db', () => ({
  db: {
    equipment: { findFirst: equipmentFindFirstMock },
    equipmentDefect: { count: defectCountMock },
  },
}));
vi.mock('@/modules/inspections', () => ({ completeInspection: completeInspectionMock }));
vi.mock('@/services/audit/audit-service', () => ({ recordAuditEvent: recordAuditEventMock }));

import { POST } from '../route';

const ADMIN = { id: 'admin-1', name: 'Админ А.', role: 'ADMIN', tenantId: 'tenant-a' };

const INSPECTION = { id: 'insp-1', equipmentId: 'eq-1', level: 'EO', healthScore: 82, status: 'COMPLETED' };

function post(): NextRequest {
  return new NextRequest('http://localhost/api/inspections/insp-1/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ signedByName: 'Петров И.И.' }),
  });
}

function params() {
  return { params: Promise.resolve({ id: 'insp-1' }) };
}

describe('POST /api/inspections/[id]/complete — след завершения осмотра (F-R72-FEED-INSPECTION)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
    completeInspectionMock.mockResolvedValue(INSPECTION);
    recordAuditEventMock.mockResolvedValue(undefined);
    equipmentFindFirstMock.mockResolvedValue({ name: 'ЭО-5111' });
    defectCountMock.mockResolvedValue(2);
  });

  it('читает установку и заведённые дефекты строго по тенанту', async () => {
    const res = await POST(post(), params());

    expect(res.status).toBe(200);
    expect(equipmentFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'eq-1', tenantId: 'tenant-a' } }),
    );
    expect(defectCountMock).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a', inspectionId: 'insp-1' } });
  });

  it('пишет inspection.completed с установкой, осмотром, баллом и дефектами', async () => {
    await POST(post(), params());

    expect(recordAuditEventMock).toHaveBeenCalledTimes(1);
    expect(recordAuditEventMock).toHaveBeenCalledWith({
      action: 'inspection.completed',
      scope: 'inspections',
      actorId: 'admin-1',
      targetId: 'insp-1',
      tenantId: 'tenant-a',
      metadata: {
        name: 'ЭО-5111',
        after: { level: 'EO', healthScore: 82, defectCount: 2 },
      },
    });
  });

  it('не пишет след, когда осмотр завершить не удалось', async () => {
    completeInspectionMock.mockRejectedValue(
      new ServiceError('Осмотр не заполнен: пунктов без ответа 2, без обязательного фото 0', 400),
    );

    const res = await POST(post(), params());

    expect(res.status).toBe(400);
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it('пишет событие без названия установки, когда её не нашли', async () => {
    equipmentFindFirstMock.mockResolvedValue(null);

    await POST(post(), params());

    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inspection.completed',
        metadata: { after: { level: 'EO', healthScore: 82, defectCount: 2 } },
      }),
    );
  });
});
