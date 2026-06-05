import { describe, it, expect, vi, beforeEach } from 'vitest';
const { createMock, updateMock, findUniqueMock } = vi.hoisted(() => ({
  createMock: vi.fn(), updateMock: vi.fn(), findUniqueMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  db: { checklistTemplate: { create: createMock, update: updateMock, findUnique: findUniqueMock } },
}));
import { createTemplate, deleteTemplate } from '../template-commands';

beforeEach(() => { createMock.mockReset(); updateMock.mockReset(); findUniqueMock.mockReset(); });

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
    await expect(deleteTemplate('t1', 'orion')).rejects.toThrow('not found');
  });
});
