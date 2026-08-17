import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findFirstUserMock, findFirstTypeMock, findManyDocMock, createDocMock, findFirstDocMock } = vi.hoisted(() => ({
  findFirstUserMock: vi.fn(),
  findFirstTypeMock: vi.fn(),
  findManyDocMock: vi.fn(),
  createDocMock: vi.fn(),
  findFirstDocMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    user: { findFirst: findFirstUserMock },
    userDocumentType: { findFirst: findFirstTypeMock },
    userDocument: {
      findMany: findManyDocMock,
      findFirst: findFirstDocMock,
      create: createDocMock,
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

// Права НЕ подменяем: смысл этих проверок — что маршрут документов подключён к
// настоящей матрице ролей, а не к её представлению в тесте.
import { listUserDocuments, createUserDocument } from '../user-documents';
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
    ).rejects.toThrow('User not found');
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
