import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findFirstMock, findManyMock, createMock, updateMock, deleteMock, recordAuditMock } = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  findManyMock: vi.fn(),
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
      findMany: findManyMock,
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
  listUserDocumentTypes,
  listUserDocumentTypesForAdmin,
  createUserDocumentType,
  updateUserDocumentType,
  deleteUserDocumentType,
} from '../user-document-types';

const ADMIN = { id: 'usr_admin', role: 'ADMIN' };
const OPERATOR = { id: 'usr_op', role: 'OPERATOR' };
const ctx = (actor: { id: string; role: string }) => ({ tenantId: 'orion', actor });

describe('справочник видов документов работника', () => {
  beforeEach(() => {
    for (const m of [findFirstMock, findManyMock, createMock, updateMock, deleteMock, recordAuditMock]) m.mockReset();
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

  it('новый вид: срок обязателен по умолчанию, оператору не обязателен, название без лишних пробелов, след записан', async () => {
    findFirstMock.mockResolvedValueOnce(null);
    createMock.mockImplementation(async ({ data }: { data: { name: string } }) => ({ id: 't9', ...data }));

    await createUserDocumentType({ name: '  Допуск к работам на высоте ' }, ctx(ADMIN));

    expect(createMock.mock.calls[0][0].data).toMatchObject({
      tenantId: 'orion', name: 'Допуск к работам на высоте', normalizedName: 'допуск к работам на высоте',
      requiresExpiry: true, leadTimeDays: 30, requiredForOperator: false, defaultValidMonths: null,
    });
    expect(recordAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.document_type.created', targetId: 't9' }));
  });

  it('пустое название вида отклоняется до обращения к базе', async () => {
    await expect(createUserDocumentType({ name: '   ' }, ctx(ADMIN))).rejects.toMatchObject({ status: 400 });
    findFirstMock.mockResolvedValueOnce({ id: 't1', name: 'Медосмотр' });
    await expect(updateUserDocumentType('t1', { name: '  ' }, ctx(ADMIN))).rejects.toMatchObject({ status: 400 });
    expect(createMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('правка меняет только присланные поля и называет их в следе', async () => {
    findFirstMock.mockResolvedValueOnce({ id: 't1', name: 'Медосмотр' });
    updateMock.mockResolvedValueOnce({ id: 't1', name: 'Медосмотр' });

    await updateUserDocumentType('t1', { requiredForOperator: true, leadTimeDays: 14, notes: ' раз в год ' }, ctx(ADMIN));

    expect(updateMock.mock.calls[0][0].data).toEqual({ requiredForOperator: true, leadTimeDays: 14, notes: 'раз в год' });
    expect([...recordAuditMock.mock.calls[0][0].metadata.changed].sort()).toEqual(['leadTimeDays', 'notes', 'requiredForOperator']);
  });

  it('переименование в уже занятое имя другим видом — 409, запись не идёт', async () => {
    findFirstMock
      .mockResolvedValueOnce({ id: 't1', name: 'Медосмотр' })
      .mockResolvedValueOnce({ id: 't2' });

    await expect(updateUserDocumentType('t1', { name: 'Удостоверение' }, ctx(ADMIN))).rejects.toMatchObject({ status: 409 });
    expect(findFirstMock.mock.calls[1][0].where).toMatchObject({ normalizedName: 'удостоверение', id: { not: 't1' } });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('отключение вида идёт через правку isActive', async () => {
    findFirstMock.mockResolvedValueOnce({ id: 't1', name: 'Медосмотр' });
    updateMock.mockResolvedValueOnce({ id: 't1', name: 'Медосмотр' });

    await updateUserDocumentType('t1', { isActive: false }, ctx(ADMIN));

    expect(updateMock.mock.calls[0][0].data).toEqual({ isActive: false });
  });

  it('форма получает только включённые виды своей организации', async () => {
    findManyMock.mockResolvedValueOnce([]);

    await listUserDocumentTypes('orion');

    expect(findManyMock.mock.calls[0][0].where).toEqual({ tenantId: 'orion', isActive: true });
  });

  it('экран управления видит и отключённые виды со счётчиком документов, оператор — нет', async () => {
    findManyMock.mockResolvedValueOnce([{ id: 't1', name: 'Медосмотр', isActive: false, _count: { documents: 3 } }]);

    const types = await listUserDocumentTypesForAdmin(ctx(ADMIN));

    expect(types).toEqual([{ id: 't1', name: 'Медосмотр', isActive: false, documentCount: 3 }]);
    expect(findManyMock.mock.calls[0][0].where).toEqual({ tenantId: 'orion' });
    await expect(listUserDocumentTypesForAdmin(ctx(OPERATOR))).rejects.toMatchObject({ status: 403 });
  });
});
