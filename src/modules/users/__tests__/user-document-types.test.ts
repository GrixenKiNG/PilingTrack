import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findFirstMock, createMock, updateMock, deleteMock, recordAuditMock } = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  recordAuditMock: vi.fn(),
}));

vi.mock('@/modules/audit', () => ({
  recordAuditEventInTx: (_tx: unknown, event: unknown) => recordAuditMock(event),
}));

vi.mock('@/lib/db', () => {
  const db = {
    userDocumentType: {
      findFirst: findFirstMock,
      create: createMock,
      update: updateMock,
      delete: deleteMock,
    },
    $transaction: (run: (tx: unknown) => unknown) => run(db),
  };
  return { db };
});

// Права НЕ подменяем: проверяем подключение к настоящей матрице ролей.
import {
  createUserDocumentType,
  updateUserDocumentType,
  deleteUserDocumentType,
} from '../user-document-types';

const ADMIN = { id: 'usr_admin', role: 'ADMIN' };
const OPERATOR = { id: 'usr_op', role: 'OPERATOR' };
const ctx = (actor: { id: string; role: string }) => ({ tenantId: 'orion', actor });

describe('справочник видов документов работника', () => {
  beforeEach(() => {
    for (const m of [findFirstMock, createMock, updateMock, deleteMock, recordAuditMock]) m.mockReset();
  });

  it('оператор не может менять справочник и до базы дело не доходит', async () => {
    await expect(createUserDocumentType({ name: 'Медосмотр' }, ctx(OPERATOR))).rejects.toMatchObject({ status: 403 });
    await expect(updateUserDocumentType('t1', { name: 'X' }, ctx(OPERATOR))).rejects.toMatchObject({ status: 403 });
    await expect(deleteUserDocumentType('t1', ctx(OPERATOR))).rejects.toMatchObject({ status: 403 });
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it('дубль по имени без учёта регистра и пробелов — 409, различая отключённый вид', async () => {
    findFirstMock.mockResolvedValueOnce({ id: 't1', isActive: true });
    await expect(createUserDocumentType({ name: '  Медосмотр ' }, ctx(ADMIN))).rejects.toMatchObject({
      status: 409,
      message: 'Такой вид документа уже есть',
    });
    expect(findFirstMock.mock.calls[0][0].where).toEqual({ tenantId: 'orion', normalizedName: 'медосмотр' });

    findFirstMock.mockResolvedValueOnce({ id: 't1', isActive: false });
    await expect(createUserDocumentType({ name: 'Медосмотр' }, ctx(ADMIN))).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('отключён'),
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('вид чужой организации не находится: 404 и без записи', async () => {
    findFirstMock.mockResolvedValue(null);
    await expect(updateUserDocumentType('foreign', { isActive: false }, ctx(ADMIN))).rejects.toMatchObject({ status: 404 });
    await expect(deleteUserDocumentType('foreign', ctx(ADMIN))).rejects.toMatchObject({ status: 404 });
    expect(findFirstMock.mock.calls[0][0].where).toEqual({ id: 'foreign', tenantId: 'orion' });
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('сбой следа не глушится: удаление вида падает вместе со следом', async () => {
    const failure = new Error('след не записан');
    recordAuditMock.mockRejectedValue(failure);
    findFirstMock.mockResolvedValueOnce({ id: 't2', name: 'Старый', _count: { documents: 0 } });
    await expect(deleteUserDocumentType('t2', ctx(ADMIN))).rejects.toBe(failure);
  });

  it('вид с документами не удаляется, а свободный удаляется со следом в аудите', async () => {
    findFirstMock.mockResolvedValueOnce({ id: 't1', name: 'Медосмотр', _count: { documents: 3 } });
    await expect(deleteUserDocumentType('t1', ctx(ADMIN))).rejects.toMatchObject({ status: 409 });
    expect(deleteMock).not.toHaveBeenCalled();

    findFirstMock.mockResolvedValueOnce({ id: 't2', name: 'Старый', _count: { documents: 0 } });
    await deleteUserDocumentType('t2', ctx(ADMIN));
    expect(deleteMock).toHaveBeenCalledWith({ where: { id: 't2' } });
    expect(recordAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'user.document_type.deleted', actorId: 'usr_admin', targetId: 't2', tenantId: 'orion',
    }));
  });
});
