/**
 * POST /api/inspections/[id]/complete — завершение осмотра.
 *
 * След `inspection.completed` (F-R72-FEED-INSPECTION) пишет сама команда
 * `completeInspectionWithOutcome` в одной транзакции с завершением и только при
 * первом завершении — повтор следа не даёт (F-R84-INSPECTION-DUP-EVENT);
 * это проверяет inspection-commands.test.ts. Маршрут передаёт команде
 * организацию, подпись и актора и отдаёт её ответ и отказы.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { ServiceError } from '@/services/service-error';

const { requireAuthMock, completeInspectionMock, recordDefectMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  completeInspectionMock: vi.fn(),
  recordDefectMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/modules/inspections', () => ({ completeInspectionWithOutcome: completeInspectionMock }));
vi.mock('@/modules/readiness/server', () => ({ recordDefectInTx: recordDefectMock }));

import { POST } from '../route';

const ADMIN = { id: 'admin-1', name: 'Админ А.', role: 'ADMIN', tenantId: 'tenant-a' };
const OPERATOR = { id: 'op-1', name: 'Оператор', role: 'OPERATOR', tenantId: 'tenant-a' };

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

describe('POST /api/inspections/[id]/complete', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
    completeInspectionMock.mockResolvedValue({ inspection: INSPECTION, replayed: false });
  });

  it('передаёт команде организацию, подпись и актора для следа', async () => {
    const res = await POST(post(), params());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ inspection: INSPECTION });
    // Дефекты осмотра записывает модуль готовности — маршрут передаёт его функцию.
    expect(completeInspectionMock).toHaveBeenCalledWith('insp-1', {
      tenantId: 'tenant-a', signedByName: 'Петров И.И.', performerId: null, actorId: 'admin-1',
      recordDefect: recordDefectMock,
    });
  });

  it('оператор завершает только свой осмотр: его id уходит как исполнитель', async () => {
    requireAuthMock.mockResolvedValue({ user: OPERATOR, error: null });

    await POST(post(), params());

    expect(completeInspectionMock).toHaveBeenCalledWith('insp-1', expect.objectContaining({
      performerId: 'op-1', actorId: 'op-1',
    }));
  });

  it('отказ команды отдаёт как есть', async () => {
    completeInspectionMock.mockRejectedValue(
      new ServiceError('Осмотр не заполнен: пунктов без ответа 2, без обязательного фото 0', 400),
    );

    const res = await POST(post(), params());

    expect(res.status).toBe(400);
  });

  it('повтор завершения отдаёт тот же ответ', async () => {
    completeInspectionMock.mockResolvedValue({ inspection: INSPECTION, replayed: true });

    const res = await POST(post(), params());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ inspection: INSPECTION });
  });

  it('неверная подпись до команды не доходит', async () => {
    const bad = new NextRequest('http://localhost/api/inspections/insp-1/complete', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signedByName: '' }),
    });

    const res = await POST(bad, params());

    expect(res.status).toBe(400);
    expect(completeInspectionMock).not.toHaveBeenCalled();
  });
});
