/**
 * POST /api/equipment/[id]/meter-readings — след записи показания
 * (F-R72-FEED-METER-MAINT).
 *
 * Показание моточасов двигает наработку и сроки ТО, но самой записи в журнале
 * не было — при том что удаление того же показания писалось
 * (`meter.reading.deleted`). Роут читает название установки до команды и после
 * успеха пишет событие `meter.reading.added` со значением м/ч. Запись нужна
 * ровно тогда, когда показание принято: на отказе команды следа быть не должно.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthMock,
  findFirstEquipmentMock,
  addMeterReadingMock,
  canDecreaseMeterMock,
  recordAuditEventMock,
  getCrewForOperatorMock,
  listMeterReadingsMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  findFirstEquipmentMock: vi.fn(),
  addMeterReadingMock: vi.fn(),
  canDecreaseMeterMock: vi.fn(),
  recordAuditEventMock: vi.fn(),
  getCrewForOperatorMock: vi.fn(),
  listMeterReadingsMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/lib/db', () => ({ db: { equipment: { findFirst: findFirstEquipmentMock } } }));
vi.mock('@/modules/equipment', () => ({
  addMeterReading: addMeterReadingMock,
  canDecreaseMeter: canDecreaseMeterMock,
  listMeterReadings: listMeterReadingsMock,
}));
vi.mock('@/modules/crews', () => ({ getCrewForOperator: getCrewForOperatorMock }));
vi.mock('@/modules/audit', () => ({ recordAuditEvent: recordAuditEventMock }));

import { GET, POST } from '../route';

const ADMIN = { id: 'admin-1', name: 'Админ А.', role: 'ADMIN', tenantId: 'tenant-a' };

const RESULT = {
  reading: { id: 'rd-1', engineHours: 1234, recordedAt: new Date('2026-09-26T08:00:00.000Z') },
  warning: null,
};

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/equipment/eq-1/meter-readings', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function params() {
  return { params: Promise.resolve({ id: 'eq-1' }) };
}

describe('POST /api/equipment/[id]/meter-readings — след записи показания (F-R72-FEED-METER-MAINT)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
    findFirstEquipmentMock.mockResolvedValue({ name: 'ЭО-5111' });
    addMeterReadingMock.mockResolvedValue(RESULT);
    canDecreaseMeterMock.mockReturnValue(true);
    recordAuditEventMock.mockResolvedValue(undefined);
  });

  it('читает название установки строго по тенанту и пишет показание', async () => {
    const res = await POST(postReq({ engineHours: 1234 }), params());

    expect(res.status).toBe(201);
    expect(findFirstEquipmentMock).toHaveBeenCalledWith({
      where: { id: 'eq-1', tenantId: 'tenant-a' },
      select: { name: true },
    });
    expect(addMeterReadingMock).toHaveBeenCalledWith(
      'eq-1',
      { engineHours: 1234 },
      { tenantId: 'tenant-a', recordedById: 'admin-1', allowDecrease: true },
    );
  });

  it('пишет meter.reading.added с названием установки и значением после успеха', async () => {
    await POST(postReq({ engineHours: 1234 }), params());

    expect(recordAuditEventMock).toHaveBeenCalledTimes(1);
    expect(recordAuditEventMock).toHaveBeenCalledWith({
      action: 'meter.reading.added',
      scope: 'equipment',
      actorId: 'admin-1',
      targetId: 'rd-1',
      tenantId: 'tenant-a',
      metadata: { name: 'ЭО-5111', after: { engineHours: 1234 } },
    });
  });

  it('пишет след только после успешной команды', async () => {
    await POST(postReq({ engineHours: 1234 }), params());

    expect(addMeterReadingMock.mock.invocationCallOrder[0]).toBeLessThan(
      recordAuditEventMock.mock.invocationCallOrder[0],
    );
  });

  it('не пишет след, когда команда отклонила показание (400)', async () => {
    const { ServiceError } = await import('@/services/service-error');
    addMeterReadingMock.mockRejectedValue(
      new ServiceError('Показание 900 м/ч меньше предыдущего (1234 м/ч).', 400),
    );

    const res = await POST(postReq({ engineHours: 900 }), params());

    expect(res.status).toBe(400);
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it('остаётся читаемым без названия установки', async () => {
    findFirstEquipmentMock.mockResolvedValue(null);

    const res = await POST(postReq({ engineHours: 1234 }), params());

    expect(res.status).toBe(201);
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'meter.reading.added',
        metadata: { after: { engineHours: 1234 } },
      }),
    );
  });
});

describe('meter ownership — requested equipment contract', () => {
  const operator = { ...ADMIN, id: 'operator-1', role: 'OPERATOR' };
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: operator, error: null });
    getCrewForOperatorMock.mockResolvedValue({ equipmentId: 'eq-1' });
    findFirstEquipmentMock.mockResolvedValue({ name: 'Rig' });
    listMeterReadingsMock.mockResolvedValue([]);
    addMeterReadingMock.mockResolvedValue(RESULT);
    canDecreaseMeterMock.mockReturnValue(false);
    recordAuditEventMock.mockResolvedValue(undefined);
  });
  const call = (method: string) => method === 'GET'
    ? GET(new NextRequest('http://localhost/api/equipment/eq-1/meter-readings'), params())
    : POST(postReq({ engineHours: 1234 }), params());

  it.each(['GET', 'POST'])('%s looks up the requested rig rather than an arbitrary first crew', async method => {
    expect((await call(method)).status).toBe(method === 'GET' ? 200 : 201);
    expect(getCrewForOperatorMock).toHaveBeenCalledWith(operator, null, 'eq-1');
  });
  it.each([
    ['GET', null], ['POST', null],
    ['GET', { equipmentId: 'other-rig' }], ['POST', { equipmentId: 'other-rig' }],
  ])('%s denies a missing or mismatched crew without touching readings', async (method, crew) => {
    getCrewForOperatorMock.mockResolvedValue(crew);
    expect((await call(String(method))).status).toBe(403);
    expect(getCrewForOperatorMock).toHaveBeenCalledWith(operator, null, 'eq-1');
    expect(addMeterReadingMock).not.toHaveBeenCalled();
    expect(listMeterReadingsMock).not.toHaveBeenCalled();
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });
  it.each(['GET', 'POST'])('%s keeps the existing ADMIN bypass', async method => {
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
    expect((await call(method)).status).toBe(method === 'GET' ? 200 : 201);
    expect(getCrewForOperatorMock).not.toHaveBeenCalled();
  });
});
