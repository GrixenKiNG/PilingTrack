import { describe, it, expect, vi, beforeEach } from 'vitest';
const m = vi.hoisted(() => ({
  tplFindUnique: vi.fn(), eqFindUnique: vi.fn(),
  insCreate: vi.fn(), insFindUnique: vi.fn(), insUpdate: vi.fn(),
  ansDeleteMany: vi.fn(), ansCreateMany: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  db: {
    checklistTemplate: { findUnique: m.tplFindUnique },
    equipment: { findUnique: m.eqFindUnique },
    inspection: { create: m.insCreate, findUnique: m.insFindUnique, update: m.insUpdate },
    inspectionAnswer: { deleteMany: m.ansDeleteMany, createMany: m.ansCreateMany },
  },
}));
import { startInspection, saveAnswers, completeInspection } from '../inspection-commands';

beforeEach(() => Object.values(m).forEach((fn) => fn.mockReset()));

describe('startInspection', () => {
  it('snapshots template items and writes tenant-scoped inspection', async () => {
    m.eqFindUnique.mockResolvedValue({ id: 'eq1', tenantId: 'orion' });
    m.tplFindUnique.mockResolvedValue({ id: 't1', tenantId: 'orion', level: 'EO',
      sections: [{ title: 'Гидросистема', items: [{ id: 'i1', text: 'x', answerType: 'YES_NO', required: true, photoRequired: false, unit: null, norm: null, provenance: null }] }] });
    m.insCreate.mockResolvedValue({ id: 'ins1' });
    await startInspection({ equipmentId: 'eq1', templateId: 't1', inspectionDate: '2026-06-03' },
      { tenantId: 'orion', userId: 'u1' });
    const data = m.insCreate.mock.calls[0][0].data;
    expect(data.tenantId).toBe('orion');
    expect(data.status).toBe('DRAFT');
    expect(Array.isArray(data.templateSnapshot)).toBe(true);
    expect(data.templateSnapshot[0].id).toBe('i1');
  });
  it('throws 404 if equipment cross-tenant', async () => {
    m.eqFindUnique.mockResolvedValue(null);
    await expect(startInspection({ equipmentId: 'x', templateId: 't1', inspectionDate: '2026-06-03' },
      { tenantId: 'orion', userId: 'u1' })).rejects.toThrow('Equipment not found');
  });
});

describe('saveAnswers', () => {
  it('throws 404 when inspection cross-tenant; does not write', async () => {
    m.insFindUnique.mockResolvedValue({ id: 'ins1', tenantId: 'other', status: 'DRAFT' });
    await expect(saveAnswers('ins1', [{ itemId: 'i1', result: 'YES' }], { tenantId: 'orion' }))
      .rejects.toThrow('Inspection not found');
    expect(m.ansCreateMany).not.toHaveBeenCalled();
  });
  it('throws 409 when inspection already completed; does not write', async () => {
    m.insFindUnique.mockResolvedValue({ id: 'ins1', tenantId: 'orion', status: 'COMPLETED' });
    await expect(saveAnswers('ins1', [{ itemId: 'i1', result: 'YES' }], { tenantId: 'orion' }))
      .rejects.toThrow(/already completed/i);
    expect(m.ansCreateMany).not.toHaveBeenCalled();
  });
  it('replaces answers and stamps tenantId + inspectionId on each', async () => {
    m.insFindUnique.mockResolvedValue({ id: 'ins1', tenantId: 'orion', status: 'DRAFT' });
    m.ansDeleteMany.mockResolvedValue({ count: 0 });
    m.ansCreateMany.mockResolvedValue({ count: 1 });
    await saveAnswers('ins1', [{ itemId: 'i1', result: 'OK', note: 'ok', photoCount: 2 }], { tenantId: 'orion' });
    expect(m.ansDeleteMany.mock.calls[0][0]).toEqual({ where: { inspectionId: 'ins1' } });
    const rows = m.ansCreateMany.mock.calls[0][0].data;
    expect(rows[0]).toMatchObject({ tenantId: 'orion', inspectionId: 'ins1', itemId: 'i1', result: 'OK', photoCount: 2 });
  });
});

describe('completeInspection', () => {
  it('rejects when required items unanswered (no status change)', async () => {
    m.insFindUnique.mockResolvedValue({
      id: 'ins1', tenantId: 'orion', status: 'DRAFT',
      templateSnapshot: [{ id: 'i1', answerType: 'YES_NO', required: true, photoRequired: false }],
      answers: [],
    });
    await expect(completeInspection('ins1', { tenantId: 'orion', signedByName: 'Иванов' }))
      .rejects.toThrow(/не заполнен/i);
    expect(m.insUpdate).not.toHaveBeenCalled();
  });
  it('completes and stores health score when all required answered', async () => {
    m.insFindUnique.mockResolvedValue({
      id: 'ins1', tenantId: 'orion', status: 'DRAFT',
      templateSnapshot: [{ id: 'i1', answerType: 'YES_NO', required: true, photoRequired: false }],
      answers: [{ itemId: 'i1', result: 'YES', photoCount: 0 }],
    });
    m.insUpdate.mockResolvedValue({ id: 'ins1', status: 'COMPLETED', healthScore: 100 });
    const res = await completeInspection('ins1', { tenantId: 'orion', signedByName: 'Иванов' });
    const data = m.insUpdate.mock.calls[0][0].data;
    expect(data.status).toBe('COMPLETED');
    expect(data.healthScore).toBe(100);
    expect(data.signedByName).toBe('Иванов');
    expect(res.healthScore).toBe(100);
  });
});
