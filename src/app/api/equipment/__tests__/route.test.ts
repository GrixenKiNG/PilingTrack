/**
 * POST /api/equipment — след заведения установки (F-R34-14).
 *
 * Заведение техники раньше не оставляло в журнале ничего. Роут пишет событие
 * `equipment.created` по СОХРАНЁННОЙ строке (после записи характеристик), а не
 * по ответу команды: тип установки пишется вторым шагом, и снимок «до записи
 * метаданных» описывал бы не то, что легло в базу.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthMock,
  createEquipmentMock,
  updateEquipmentMetadataMock,
  getEquipmentByIdOrThrowMock,
  recordAuditEventMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  createEquipmentMock: vi.fn(),
  updateEquipmentMetadataMock: vi.fn(),
  getEquipmentByIdOrThrowMock: vi.fn(),
  recordAuditEventMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/services/auth/authorization-service', () => ({ assertCan: vi.fn() }));
vi.mock('@/services/audit/audit-service', () => ({ recordAuditEvent: recordAuditEventMock }));
vi.mock('@/modules/equipment', () => ({
  createEquipment: createEquipmentMock,
  getEquipmentByIdOrThrow: getEquipmentByIdOrThrowMock,
  listAllEquipment: vi.fn(),
  updateEquipmentMetadata: updateEquipmentMetadataMock,
  canDecreaseMeter: vi.fn().mockReturnValue(true),
}));

import { POST } from '../route';

const ADMIN = { id: 'admin-1', name: 'Админ А.', role: 'ADMIN', tenantId: 'tenant-a' };

const SAVED = {
  id: 'eq-1',
  name: 'ЭО-5111',
  model: 'ЭО-5111А',
  description: '',
  qty: 2,
  isActive: true,
};

function postReq(): NextRequest {
  return new NextRequest('http://localhost/api/equipment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'ЭО-5111' }),
  });
}

describe('POST /api/equipment — след заведения установки (F-R34-14)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
    createEquipmentMock.mockResolvedValue({ id: 'eq-1' });
    updateEquipmentMetadataMock.mockResolvedValue(true);
    getEquipmentByIdOrThrowMock.mockResolvedValue(SAVED);
    recordAuditEventMock.mockResolvedValue(undefined);
  });

  it('пишет equipment.created по сохранённой строке и отвечает 201', async () => {
    const res = await POST(postReq());

    expect(res.status).toBe(201);
    expect(recordAuditEventMock).toHaveBeenCalledTimes(1);
    expect(recordAuditEventMock).toHaveBeenCalledWith({
      action: 'equipment.created',
      scope: 'equipment',
      actorId: 'admin-1',
      targetId: 'eq-1',
      tenantId: 'tenant-a',
      metadata: {
        name: 'ЭО-5111',
        after: { name: 'ЭО-5111', model: 'ЭО-5111А', qty: 2, isActive: true },
      },
    });
  });

  it('пишет след после записи характеристик — снимок берётся из перечитанной строки', async () => {
    await POST(postReq());

    expect(getEquipmentByIdOrThrowMock).toHaveBeenCalledWith('eq-1', 'tenant-a');
    expect(recordAuditEventMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      updateEquipmentMetadataMock.mock.invocationCallOrder[0],
    );
  });
});
