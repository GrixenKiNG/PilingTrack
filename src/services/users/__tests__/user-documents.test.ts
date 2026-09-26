import { beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluateOperatorClearance } from '../operator-clearance';

const { findFirstUserMock, findFirstTypeMock, findManyTypeMock, findManyDocMock, createDocMock, findFirstDocMock, mediaFindUniqueMock, updateDocMock } = vi.hoisted(() => ({
  findFirstUserMock: vi.fn(),
  findFirstTypeMock: vi.fn(),
  findManyTypeMock: vi.fn(),
  findManyDocMock: vi.fn(),
  createDocMock: vi.fn(),
  findFirstDocMock: vi.fn(),
  mediaFindUniqueMock: vi.fn(),
  updateDocMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    user: { findFirst: findFirstUserMock },
    userDocumentType: { findFirst: findFirstTypeMock, findMany: findManyTypeMock },
    media: { findUnique: mediaFindUniqueMock },
    userDocument: {
      findMany: findManyDocMock,
      findFirst: findFirstDocMock,
      create: createDocMock,
      update: updateDocMock,
      delete: vi.fn(),
    },
  },
}));

// Права НЕ подменяем: смысл этих проверок — что маршрут документов подключён к
// настоящей матрице ролей, а не к её представлению в тесте.
import { listUserDocuments, createUserDocument, updateUserDocument, listDocumentsNeedingAttention } from '../user-documents';
import { documentExpiry } from '@/lib/document-expiry';

const OPERATOR = { id: 'usr_op', role: 'OPERATOR' };
const DISPATCHER = { id: 'usr_disp', role: 'DISPATCHER' };
const ctx = (actor: { id: string; role: string }) => ({ tenantId: 'orion', actor });

describe('документы работника — доступ', () => {
  beforeEach(() => {
    findFirstUserMock.mockReset();
    findFirstTypeMock.mockReset();
    findManyDocMock.mockReset();
    createDocMock.mockReset();
    mediaFindUniqueMock.mockReset();
    findFirstUserMock.mockResolvedValue({ id: 'usr_other', name: 'Машинист' });
    findFirstTypeMock.mockResolvedValue({ id: 'type_1', requiresExpiry: true, name: 'Медосмотр' });
    findManyDocMock.mockResolvedValue([]);
  });

  it('оператор не видит документы другого работника', async () => {
    await expect(listUserDocuments('usr_other', ctx(OPERATOR))).rejects.toThrow(/Недостаточно прав/);
  });

  it('свои документы оператор видит без особых прав', async () => {
    findFirstUserMock.mockResolvedValue({ id: OPERATOR.id, name: 'Машинист' });
    await expect(listUserDocuments(OPERATOR.id, ctx(OPERATOR))).resolves.toEqual([]);
  });

  it('диспетчер видит чужие — ему контролировать просрочку', async () => {
    await expect(listUserDocuments('usr_other', ctx(DISPATCHER))).resolves.toEqual([]);
  });

  it('оператор не может завести документ другому работнику', async () => {
    await expect(
      createUserDocument('usr_other', { typeId: 'type_1', expiresAt: '2027-01-01' }, ctx(OPERATOR)),
    ).rejects.toThrow(/Недостаточно прав/);
    expect(createDocMock).not.toHaveBeenCalled();
  });

  // Межтенантная дыра: работник соседнего тенанта не должен находиться вовсе.
  it('работник чужого тенанта не найден, документ не создаётся', async () => {
    findFirstUserMock.mockResolvedValue(null);
    await expect(
      createUserDocument('usr_alien', { typeId: 'type_1' }, ctx({ id: 'usr_admin', role: 'ADMIN' })),
    ).rejects.toThrow('Пользователь не найден');
    expect(createDocMock).not.toHaveBeenCalled();
  });

  it('вид документа чужого тенанта не подшивается', async () => {
    findFirstTypeMock.mockResolvedValue(null);
    await expect(
      createUserDocument('usr_other', { typeId: 'type_alien' }, ctx({ id: 'usr_admin', role: 'ADMIN' })),
    ).rejects.toThrow('Вид документа не найден');
    expect(createDocMock).not.toHaveBeenCalled();
  });

  it('срок обязателен там, где вид документа его требует', async () => {
    await expect(
      createUserDocument('usr_other', { typeId: 'type_1' }, ctx({ id: 'usr_admin', role: 'ADMIN' })),
    ).rejects.toThrow(/нужно указать срок действия/);
  });
});

describe('прикрепление файла к документу', () => {
  const ADMIN = { id: 'usr_admin', role: 'ADMIN' };
  const validMedia = { id: 'media_ok', tenantId: 'orion', userId: 'usr_other', uploadStatus: 'completed', isDeleted: false };

  beforeEach(() => {
    createDocMock.mockResolvedValue({ id: 'doc_1', typeId: 'type_1' });
    updateDocMock.mockResolvedValue({ id: 'doc_1', typeId: 'type_1' });
  });

  it('чужой файл (загрузил не владелец и не админ) к документу не подшивается', async () => {
    mediaFindUniqueMock.mockResolvedValue({ ...validMedia, userId: 'usr_intruder' });
    await expect(
      createUserDocument('usr_other', { typeId: 'type_1', expiresAt: '2027-01-01', mediaId: 'media_ok' }, ctx(ADMIN)),
    ).rejects.toThrow(/недоступен для прикрепления/);
    expect(createDocMock).not.toHaveBeenCalled();
  });

  it('файл чужого тенанта не подшивается', async () => {
    mediaFindUniqueMock.mockResolvedValue({ ...validMedia, tenantId: 'tenant_2' });
    await expect(
      createUserDocument('usr_other', { typeId: 'type_1', expiresAt: '2027-01-01', mediaId: 'media_ok' }, ctx(ADMIN)),
    ).rejects.toThrow(/недоступен для прикрепления/);
  });

  it('файл с незавершённой загрузкой не подшивается', async () => {
    mediaFindUniqueMock.mockResolvedValue({ ...validMedia, uploadStatus: 'pending' });
    await expect(
      createUserDocument('usr_other', { typeId: 'type_1', expiresAt: '2027-01-01', mediaId: 'media_ok' }, ctx(ADMIN)),
    ).rejects.toThrow(/недоступен для прикрепления/);
  });

  it('удалённый файл не подшивается', async () => {
    mediaFindUniqueMock.mockResolvedValue({ ...validMedia, isDeleted: true });
    await expect(
      createUserDocument('usr_other', { typeId: 'type_1', expiresAt: '2027-01-01', mediaId: 'media_ok' }, ctx(ADMIN)),
    ).rejects.toThrow(/недоступен для прикрепления/);
  });

  it('файл, загруженный самим владельцем документа, подшивается', async () => {
    mediaFindUniqueMock.mockResolvedValue(validMedia);
    await createUserDocument('usr_other', { typeId: 'type_1', expiresAt: '2027-01-01', mediaId: 'media_ok' }, ctx(ADMIN));
    expect(createDocMock).toHaveBeenCalledTimes(1);
  });

  it('файл, загруженный админом за работника, подшивается (users.manage)', async () => {
    mediaFindUniqueMock.mockResolvedValue({ ...validMedia, userId: ADMIN.id });
    await createUserDocument('usr_other', { typeId: 'type_1', expiresAt: '2027-01-01', mediaId: 'media_ok' }, ctx(ADMIN));
    expect(createDocMock).toHaveBeenCalledTimes(1);
  });

  it('при правке документа чужой файл не подшивается', async () => {
    mediaFindUniqueMock.mockResolvedValue({ ...validMedia, userId: 'usr_intruder' });
    findFirstDocMock.mockResolvedValue({ id: 'doc_1', typeId: 'type_1', issuedAt: null, expiresAt: null });
    await expect(
      updateUserDocument('usr_other', 'doc_1', { mediaId: 'media_ok' }, ctx(ADMIN)),
    ).rejects.toThrow(/недоступен для прикрепления/);
    expect(updateDocMock).not.toHaveBeenCalled();
  });
});

describe('срок годности документа', () => {
  const now = new Date('2026-08-15T00:00:00Z');

  it('различает просроченный, истекающий и действующий', () => {
    expect(documentExpiry('2026-08-01T00:00:00Z', 30, now).status).toBe('expired');
    expect(documentExpiry('2026-09-01T00:00:00Z', 30, now).status).toBe('expiring');
    expect(documentExpiry('2027-09-01T00:00:00Z', 30, now).status).toBe('ok');
  });

  it('бессрочный документ никогда не просрочен', () => {
    expect(documentExpiry(null, 30, now)).toEqual({ status: 'perpetual', daysLeft: null });
  });
});

describe('listDocumentsNeedingAttention — фильтр перенесён в where', () => {
  const now = new Date('2026-08-15T00:00:00Z');
  const DAY_MS = 86_400_000;

  beforeEach(() => {
    findManyTypeMock.mockReset();
    findManyDocMock.mockReset();
    // Виды документов тенанта: максимум leadTimeDays = 60.
    findManyTypeMock.mockResolvedValue([
      { leadTimeDays: 30 },
      { leadTimeDays: 60 },
      { leadTimeDays: 45 },
    ]);
    findManyDocMock.mockResolvedValue([]);
  });

  it('where содержит нижнюю границу expiresAt.lte = now + maxLeadTimeDays', async () => {
    const documents = await listDocumentsNeedingAttention(ctx(DISPATCHER), now);

    expect(documents).toEqual([]);
    expect(findManyTypeMock).toHaveBeenCalledWith({
      where: { tenantId: 'orion' },
      select: { leadTimeDays: true },
    });

    const callArgs = findManyDocMock.mock.calls[0][0];
    const lte = callArgs.where.expiresAt.lte;
    expect(lte).toBeInstanceOf(Date);
    expect(lte.getTime()).toBe(now.getTime() + 60 * DAY_MS);
    // С устаревшим документом и неактивным пользователем JS-часть всё ещё
    // работает, но isActive пользователя отсекается на стороне БД.
    expect(callArgs.where.user).toEqual({ is: { isActive: true } });
  });

  it('сохраняет прежний результат: отбирает просроченные и истекающие', async () => {
    const type = { id: 'type-1', name: 'Удостоверение', leadTimeDays: 30 };
    findManyDocMock.mockResolvedValue([
      { id: 'd1', expiresAt: new Date('2026-08-01T00:00:00Z'), type, user: { id: 'u1', name: 'Машинист', role: 'OPERATOR', isActive: true } },
      { id: 'd2', expiresAt: new Date('2026-09-01T00:00:00Z'), type, user: { id: 'u2', name: 'Водитель', role: 'OPERATOR', isActive: true } },
      { id: 'd3', expiresAt: new Date('2027-09-01T00:00:00Z'), type, user: { id: 'u3', name: 'Крановщик', role: 'OPERATOR', isActive: true } },
    ]);

    const documents = await listDocumentsNeedingAttention(ctx(DISPATCHER), now);

    expect(documents.map((d) => d.id)).toEqual(['d1', 'd2']);
  });
});

describe('evaluateOperatorClearance', () => {
  const now = new Date('2026-08-20T09:00:00Z');
  const type = { id: 'type-1', name: 'Удостоверение машиниста', leadTimeDays: 30 };
  const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000);

  it('без обязательных видов допуск чист — требований система не выдумывает', () => {
    expect(evaluateOperatorClearance([], [], now).cleared).toBe(true);
  });

  it('отсутствие обязательного документа не пускает к работе', () => {
    const result = evaluateOperatorClearance([type], [], now);
    expect(result.cleared).toBe(false);
    expect(result.blockers[0].reason).toBe('missing');
  });

  it('просроченный документ не пускает к работе', () => {
    const result = evaluateOperatorClearance([type], [{ typeId: 'type-1', expiresAt: day(-2) }], now);
    expect(result.cleared).toBe(false);
    expect(result.blockers[0].reason).toBe('expired');
  });

  it('истекающий документ предупреждает, но допуска не снимает', () => {
    const result = evaluateOperatorClearance([type], [{ typeId: 'type-1', expiresAt: day(10) }], now);
    expect(result.cleared).toBe(true);
    expect(result.warnings[0].reason).toBe('expiring');
  });

  it('новое удостоверение перекрывает старое просроченное', () => {
    const result = evaluateOperatorClearance([type], [
      { typeId: 'type-1', expiresAt: day(-100) },
      { typeId: 'type-1', expiresAt: day(400) },
    ], now);
    expect(result.cleared).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('чужие виды документов допуск не закрывают', () => {
    const result = evaluateOperatorClearance([type], [{ typeId: 'type-2', expiresAt: day(400) }], now);
    expect(result.cleared).toBe(false);
  });
});
