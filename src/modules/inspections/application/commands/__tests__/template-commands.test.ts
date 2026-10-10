import { describe, it, expect, vi, beforeEach } from 'vitest';
const { createMock, updateMock, findUniqueMock, transactionMock } = vi.hoisted(() => ({
  createMock: vi.fn(), updateMock: vi.fn(), findUniqueMock: vi.fn(), transactionMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  db: { checklistTemplate: { create: createMock, update: updateMock, findUnique: findUniqueMock }, $transaction: transactionMock },
}));
import { createTemplate, deleteTemplate, updateTemplate } from '../template-commands';

beforeEach(() => { createMock.mockReset(); updateMock.mockReset(); findUniqueMock.mockReset(); });

describe('updateTemplate — атомарная замена действующего шаблона (W117)', () => {
  type Row = { id: string; tenantId: string; name: string; isActive: boolean };
  let stored: Row[];
  let failCommit: boolean;
  const ctx = { tenantId: 'orion', createdById: 'u1' };

  function clientFor(rows: Row[]) {
    return { checklistTemplate: {
      findUnique: async ({ where }: { where: { id: string } }) => rows.find((row) => row.id === where.id) ?? null,
      update: async ({ where }: { where: { id: string } }) => {
        const row = rows.find((item) => item.id === where.id);
        if (!row) throw new Error('missing row');
        row.isActive = false;
        return { ...row };
      },
      create: async ({ data }: { data: { name: string; tenantId: string } }) => {
        if (data.name === 'Ошибка вставки') throw new Error('create failed');
        const row = { id: 'new-1', tenantId: data.tenantId, name: data.name, isActive: true };
        rows.push(row);
        return row;
      },
    } };
  }

  beforeEach(() => {
    stored = [{ id: 'old-1', tenantId: 'orion', name: 'Прежний осмотр', isActive: true }];
    failCommit = false;
    const direct = clientFor(stored).checklistTemplate;
    createMock.mockImplementation(direct.create);
    updateMock.mockImplementation(direct.update);
    findUniqueMock.mockImplementation(direct.findUnique);
    transactionMock.mockReset().mockImplementation(async (run: (tx: ReturnType<typeof clientFor>) => Promise<unknown>) => {
      const staged = stored.map((row) => ({ ...row }));
      const result = await run(clientFor(staged));
      if (failCommit) throw new Error('commit failed');
      stored = staged;
      return result;
    });
  });

  it('сбой создания нового сохраняет прежний шаблон действующим', async () => {
    await expect(updateTemplate('old-1', { name: 'Ошибка вставки', level: 'EO', sections: [] }, ctx)).rejects.toThrow('create failed');
    expect(stored).toEqual([{ id: 'old-1', tenantId: 'orion', name: 'Прежний осмотр', isActive: true }]);
  });
  it('сбой фиксации сохраняет старый активным и не оставляет нового', async () => {
    failCommit = true;
    await expect(updateTemplate('old-1', { name: 'Новый осмотр', level: 'EO', sections: [] }, ctx)).rejects.toThrow('commit failed');
    expect(stored).toEqual([{ id: 'old-1', tenantId: 'orion', name: 'Прежний осмотр', isActive: true }]);
  });
  it('успешная замена отключает старый и оставляет новый действующим', async () => {
    const result = await updateTemplate('old-1', { name: 'Новый осмотр', level: 'EO', sections: [] }, ctx);
    expect(result.id).toBe('new-1');
    expect(stored).toEqual([
      { id: 'old-1', tenantId: 'orion', name: 'Прежний осмотр', isActive: false },
      { id: 'new-1', tenantId: 'orion', name: 'Новый осмотр', isActive: true },
    ]);
  });
  it('чужая организация по-прежнему не может заменить шаблон', async () => {
    await expect(updateTemplate('old-1', { name: 'Чужой осмотр', level: 'EO', sections: [] }, { ...ctx, tenantId: 'other' })).rejects.toThrow('Шаблон не найден — обновите список.');
    expect(stored).toHaveLength(1);
    expect(stored[0].isActive).toBe(true);
  });
  it('без организации по-прежнему нельзя отключить старый шаблон', async () => {
    await expect(updateTemplate('old-1', { name: 'Новый осмотр', level: 'EO', sections: [] }, { ...ctx, tenantId: '' })).rejects.toThrow('tenantId is required');
    expect(stored).toHaveLength(1);
    expect(stored[0].isActive).toBe(true);
  });
});

describe('createTemplate', () => {
  it('writes tenantId on template, sections and items', async () => {
    createMock.mockResolvedValue({ id: 't1' });
    await createTemplate({
      name: 'ЕО гидромолота', level: 'EO', appliesToModel: 'HHK7A',
      sections: [{ title: 'Гидросистема', order: 0, items: [
        { text: 'РВД без течей', answerType: 'YES_NO', required: true, photoRequired: false, order: 0 },
      ]}],
    }, { tenantId: 'orion', createdById: 'u1' });
    const data = createMock.mock.calls[0][0].data;
    expect(data.tenantId).toBe('orion');
    expect(data.sections.create[0].tenantId).toBe('orion');
    expect(data.sections.create[0].items.create[0].tenantId).toBe('orion');
  });
  it('throws when tenantId empty', async () => {
    await expect(createTemplate({ name: 'x', level: 'EO', sections: [] }, { tenantId: '' })).rejects.toThrow();
  });
});

describe('deleteTemplate', () => {
  it('soft-deactivates own-tenant template', async () => {
    findUniqueMock.mockResolvedValue({ id: 't1', tenantId: 'orion' });
    updateMock.mockResolvedValue({ id: 't1', isActive: false });
    await deleteTemplate('t1', 'orion');
    expect(updateMock.mock.calls[0][0]).toMatchObject({ where: { id: 't1' }, data: { isActive: false } });
  });
  it('throws 404 cross-tenant', async () => {
    findUniqueMock.mockResolvedValue({ id: 't1', tenantId: 'other' });
    await expect(deleteTemplate('t1', 'orion')).rejects.toThrow('Шаблон не найден — обновите список.');
  });
});
