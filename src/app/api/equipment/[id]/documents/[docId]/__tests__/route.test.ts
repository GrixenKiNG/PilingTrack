/**
 * DELETE /api/equipment/[id]/documents/[docId] — след удаления документа (F-R39-3).
 *
 * Документ установки (страховка, свидетельство, паспорт) удалялся без следа:
 * для проверок ОТ и страхования важно задним числом видеть, что документ
 * прикладывали и до какого срока он действовал. Роут читает снимок ДО удаления
 * и после успеха пишет `equipment.document.deleted` с названием, типом, сроком
 * и названием установки.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthMock,
  findFirstDocMock,
  deleteEquipmentDocumentMock,
  recordAuditEventMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  findFirstDocMock: vi.fn(),
  deleteEquipmentDocumentMock: vi.fn(),
  recordAuditEventMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/lib/db', () => ({ db: { equipmentDocument: { findFirst: findFirstDocMock } } }));
vi.mock('@/modules/equipment', () => ({ deleteEquipmentDocument: deleteEquipmentDocumentMock }));
vi.mock('@/services/audit/audit-service', () => ({ recordAuditEvent: recordAuditEventMock }));
vi.mock('@/lib/logger', () => ({
  logger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { DELETE } from '../route';

const ADMIN = { id: 'admin-1', name: 'Админ А.', role: 'ADMIN', tenantId: 'tenant-a' };

const DOC_ROW = {
  type: 'INSURANCE',
  title: 'Полис ОСАГО',
  expiresAt: new Date('2027-01-01T00:00:00.000Z'),
  equipment: { name: 'ЭО-5111' },
};

function deleteReq(): NextRequest {
  return new NextRequest('http://localhost/api/equipment/eq-1/documents/doc-1', { method: 'DELETE' });
}

function params() {
  return { params: Promise.resolve({ id: 'eq-1', docId: 'doc-1' }) };
}

describe('DELETE /api/equipment/[id]/documents/[docId] — снимок и след (F-R39-3)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
    findFirstDocMock.mockResolvedValue(DOC_ROW);
    deleteEquipmentDocumentMock.mockResolvedValue(undefined);
    recordAuditEventMock.mockResolvedValue(undefined);
  });

  it('читает документ строго по тенанту и вперёд удаления', async () => {
    const res = await DELETE(deleteReq(), params());

    expect(res.status).toBe(200);
    expect(findFirstDocMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'doc-1', equipmentId: 'eq-1', tenantId: 'tenant-a' } }),
    );
    expect(findFirstDocMock.mock.invocationCallOrder[0]).toBeLessThan(
      deleteEquipmentDocumentMock.mock.invocationCallOrder[0],
    );
    expect(deleteEquipmentDocumentMock).toHaveBeenCalledWith('eq-1', 'doc-1', { tenantId: 'tenant-a' });
  });

  it('пишет equipment.document.deleted с названием, типом, сроком и установкой', async () => {
    await DELETE(deleteReq(), params());

    expect(recordAuditEventMock).toHaveBeenCalledTimes(1);
    expect(recordAuditEventMock).toHaveBeenCalledWith({
      action: 'equipment.document.deleted',
      scope: 'equipment',
      actorId: 'admin-1',
      targetId: 'doc-1',
      tenantId: 'tenant-a',
      metadata: {
        name: 'ЭО-5111',
        before: {
          type: 'INSURANCE',
          title: 'Полис ОСАГО',
          expiresAt: DOC_ROW.expiresAt,
        },
      },
    });
  });

  it('не пишет след, когда документ не найден (404)', async () => {
    const { ServiceError } = await import('@/services/service-error');
    deleteEquipmentDocumentMock.mockRejectedValue(new ServiceError('Документ не найден', 404));

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
