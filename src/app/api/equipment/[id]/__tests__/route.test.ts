/**
 * PUT / DELETE /api/equipment/[id] — след правки, вывода из эксплуатации и
 * удаления установки (F-R34-14).
 *
 * Снимок «до» читается перед изменением и строго по тенанту: после `update` (а
 * тем более после `delete`) прежних значений взять уже негде. Правка пишет
 * `equipment.updated` с before/after ТОЛЬКО изменившихся полей, снятие флага
 * активности — отдельное `equipment.retired` (установка перестаёт допускаться к
 * работе), удаление — `equipment.deleted` со снимком карточки. Сбой записи следа
 * не должен превращать успешное удаление в 500.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthMock,
  findFirstEquipmentMock,
  updateEquipmentMock,
  getEquipmentByIdOrThrowMock,
  deleteEquipmentMock,
  recordAuditEventMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  findFirstEquipmentMock: vi.fn(),
  updateEquipmentMock: vi.fn(),
  getEquipmentByIdOrThrowMock: vi.fn(),
  deleteEquipmentMock: vi.fn(),
  recordAuditEventMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/services/auth/authorization-service', () => ({ assertCan: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { equipment: { findFirst: findFirstEquipmentMock } } }));
vi.mock('@/lib/logger', () => ({
  logger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/audit/audit-service', () => ({ recordAuditEvent: recordAuditEventMock }));
vi.mock('@/modules/equipment', () => ({
  updateEquipment: updateEquipmentMock,
  updateEquipmentMetadata: vi.fn().mockResolvedValue(true),
  getEquipmentByIdOrThrow: getEquipmentByIdOrThrowMock,
  deleteEquipment: deleteEquipmentMock,
  canDecreaseMeter: vi.fn().mockReturnValue(true),
}));

import { PUT, DELETE } from '../route';

const ADMIN = { id: 'admin-1', name: 'Админ А.', role: 'ADMIN', tenantId: 'tenant-a' };

const BEFORE = { name: 'ЭО-5110', model: 'ЭО-5110', description: '', qty: 1, isActive: true };

function putReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/equipment/eq-1', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedUpdatedAt: '2026-10-03T00:00:00.000Z', ...body }),
  });
}

function deleteReq(): NextRequest {
  return new NextRequest('http://localhost/api/equipment/eq-1', { method: 'DELETE' });
}

function params() {
  return { params: Promise.resolve({ id: 'eq-1' }) };
}

describe('PUT /api/equipment/[id] — след правки (F-R34-14)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
    findFirstEquipmentMock.mockResolvedValue(BEFORE);
    updateEquipmentMock.mockResolvedValue(undefined);
    recordAuditEventMock.mockResolvedValue(undefined);
  });

  it('читает снимок по тенанту и вперёд изменения', async () => {
    getEquipmentByIdOrThrowMock.mockResolvedValue({ ...BEFORE, isActive: true });

    const res = await PUT(putReq({ name: 'ЭО-5110' }), params());

    expect(res.status).toBe(200);
    expect(findFirstEquipmentMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'eq-1', tenantId: 'tenant-a' } }),
    );
    expect(findFirstEquipmentMock.mock.invocationCallOrder[0]).toBeLessThan(
      updateEquipmentMock.mock.invocationCallOrder[0],
    );
  });

  it('пишет equipment.updated только с изменившимися полями', async () => {
    getEquipmentByIdOrThrowMock.mockResolvedValue({ ...BEFORE, name: 'ЭО-5111', qty: 2 });

    await PUT(putReq({ name: 'ЭО-5111', qty: 2 }), params());

    expect(recordAuditEventMock).toHaveBeenCalledTimes(1);
    expect(recordAuditEventMock).toHaveBeenCalledWith({
      action: 'equipment.updated',
      scope: 'equipment',
      actorId: 'admin-1',
      targetId: 'eq-1',
      tenantId: 'tenant-a',
      metadata: {
        name: 'ЭО-5111',
        before: { name: 'ЭО-5110', qty: 1 },
        after: { name: 'ЭО-5111', qty: 2 },
      },
    });
  });

  it('снятие флага активности отмечает отдельным equipment.retired', async () => {
    getEquipmentByIdOrThrowMock.mockResolvedValue({ ...BEFORE, isActive: false });

    await PUT(putReq({ isActive: false }), params());

    expect(recordAuditEventMock).toHaveBeenCalledTimes(1);
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'equipment.retired',
        scope: 'equipment',
        metadata: {
          name: 'ЭО-5110',
          before: { isActive: true },
          after: { isActive: false },
        },
      }),
    );
  });
});

describe('DELETE /api/equipment/[id] — снимок и след (F-R34-14)', () => {
  const SNAPSHOT = { name: 'ЭО-5111', model: 'ЭО-5111А', kind: 'PILE_DRIVER', isActive: false };

  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
    findFirstEquipmentMock.mockResolvedValue(SNAPSHOT);
    deleteEquipmentMock.mockResolvedValue({ success: true });
    recordAuditEventMock.mockResolvedValue(undefined);
  });

  it('читает карточку до удаления и пишет equipment.deleted со снимком', async () => {
    const res = await DELETE(deleteReq(), params());

    expect(res.status).toBe(200);
    expect(findFirstEquipmentMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'eq-1', tenantId: 'tenant-a' } }),
    );
    expect(findFirstEquipmentMock.mock.invocationCallOrder[0]).toBeLessThan(
      deleteEquipmentMock.mock.invocationCallOrder[0],
    );
    expect(recordAuditEventMock).toHaveBeenCalledWith({
      action: 'equipment.deleted',
      scope: 'equipment',
      actorId: 'admin-1',
      targetId: 'eq-1',
      tenantId: 'tenant-a',
      metadata: {
        name: 'ЭО-5111',
        before: { model: 'ЭО-5111А', kind: 'PILE_DRIVER', isActive: false },
      },
    });
  });

  it('остаётся успешным, когда запись следа упала', async () => {
    recordAuditEventMock.mockRejectedValue(new Error('feed down'));

    const res = await DELETE(deleteReq(), params());

    expect(res.status).toBe(200);
    expect(loggerErrorMock).toHaveBeenCalled();
  });
});


it('PUT требует версию карточки до изменения', async () => {
  vi.resetAllMocks();
  recordAuditEventMock.mockResolvedValue(undefined);
  updateEquipmentMock.mockResolvedValue(undefined);
  requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
  findFirstEquipmentMock.mockResolvedValue(BEFORE);
  getEquipmentByIdOrThrowMock.mockResolvedValue(BEFORE);
  const res = await PUT(putReq({ name: 'Без версии', expectedUpdatedAt: undefined }), params());
  expect(res.status).toBe(400);
});


it('PUT передаёт предусловие и возвращает 409 без успеха', async () => {
  vi.resetAllMocks();
  requireAuthMock.mockResolvedValue({user:ADMIN,error:null});
  findFirstEquipmentMock.mockResolvedValue(BEFORE);
  const { ServiceError } = await import('@/lib/service-error');
  updateEquipmentMock.mockRejectedValue(new ServiceError('Карточка изменена',409));
  const res = await PUT(putReq({name:'Правка'}),params());
  expect(res.status).toBe(409);
  expect(updateEquipmentMock).toHaveBeenCalledWith(expect.objectContaining({tenantId:'tenant-a',expectedUpdatedAt:'2026-10-03T00:00:00.000Z'}));
  expect(recordAuditEventMock).not.toHaveBeenCalled();
});
