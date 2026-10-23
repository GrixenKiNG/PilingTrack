import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Чужая организация: осмотры и шаблоны другой организации нельзя ни записать,
 * ни завершить, ни отключить. Каждый случай проверяет два факта: отказ 404
 * (а не 403 — чужую запись нельзя даже обнаружить) и ни одной записи в базу.
 */
const m = vi.hoisted(() => ({
  insFindUnique: vi.fn(),
  tplFindUnique: vi.fn(),
  // Любая запись: если хоть одна дошла до базы, тест падает.
  write: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('@/modules/audit', () => ({ recordAuditEvent: m.audit, recordAuditEventInTx: m.audit }));
vi.mock('@/modules/equipment/application/commands/maintenance-regulation', () => ({ advanceMaintenanceRegulation: m.write }));
vi.mock('@/lib/db', () => {
  const client = {
    inspection: {
      findUnique: m.insFindUnique, create: m.write, update: m.write, updateMany: m.write, delete: m.write,
    },
    inspectionAnswer: { deleteMany: m.write, createMany: m.write },
    checklistTemplate: {
      findUnique: m.tplFindUnique, create: m.write, update: m.write, updateMany: m.write,
    },
    media: { groupBy: m.write },
    outboxEvent: { create: m.write, createMany: m.write },
    $executeRaw: m.write,
    $queryRaw: m.write,
    $transaction: (run: (tx: unknown) => unknown) => run(client),
  };
  return { db: client };
});

import { saveAnswers, completeInspectionWithOutcome } from '../inspection-commands';
import { updateTemplate, deleteTemplate } from '../template-commands';

const FOREIGN_INSPECTION = {
  id: 'ins-b', tenantId: 'tenant-b', status: 'IN_PROGRESS', performedById: 'operator-b', answers: [],
};
const FOREIGN_TEMPLATE = { id: 'tpl-b', tenantId: 'tenant-b' };
const TEMPLATE_INPUT = { name: 'Подмена', level: 'EO', sections: [] } as never;

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  m.insFindUnique.mockResolvedValue(FOREIGN_INSPECTION);
  m.tplFindUnique.mockResolvedValue(FOREIGN_TEMPLATE);
});

describe('осмотры: организация A не трогает осмотр организации B', () => {
  it('saveAnswers → 404, записи нет', async () => {
    await expect(saveAnswers('ins-b', [], { tenantId: 'tenant-a' })).rejects.toMatchObject({ status: 404 });
    expect(m.insFindUnique).toHaveBeenCalledTimes(1);
    expect(m.write).not.toHaveBeenCalled();
  });

  it('completeInspectionWithOutcome → 404, записи, следа и событий нет', async () => {
    await expect(completeInspectionWithOutcome('ins-b', { tenantId: 'tenant-a', signedByName: 'Чужой' }))
      .rejects.toMatchObject({ status: 404 });
    expect(m.insFindUnique).toHaveBeenCalledTimes(1);
    expect(m.write).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });

  it('оператор не пишет в осмотр коллеги даже внутри своей организации', async () => {
    m.insFindUnique.mockResolvedValue({ ...FOREIGN_INSPECTION, tenantId: 'tenant-a' });
    await expect(saveAnswers('ins-b', [], { tenantId: 'tenant-a', performerId: 'operator-a' }))
      .rejects.toMatchObject({ status: 404 });
    await expect(completeInspectionWithOutcome('ins-b', { tenantId: 'tenant-a', signedByName: 'Я', performerId: 'operator-a' }))
      .rejects.toMatchObject({ status: 404 });
    expect(m.write).not.toHaveBeenCalled();
  });

  it('пустая организация — отказ 400 до обращения к базе', async () => {
    await expect(saveAnswers('ins-b', [], { tenantId: '' })).rejects.toMatchObject({ status: 400 });
    await expect(completeInspectionWithOutcome('ins-b', { tenantId: '', signedByName: 'x' })).rejects.toMatchObject({ status: 400 });
    expect(m.insFindUnique).not.toHaveBeenCalled();
    expect(m.write).not.toHaveBeenCalled();
  });
});

describe('шаблоны осмотра: организация A не меняет шаблон организации B', () => {
  it('deleteTemplate → 404, шаблон остаётся действующим', async () => {
    await expect(deleteTemplate('tpl-b', 'tenant-a')).rejects.toMatchObject({ status: 404 });
    expect(m.tplFindUnique).toHaveBeenCalledTimes(1);
    expect(m.write).not.toHaveBeenCalled();
  });

  it('updateTemplate → 404: чужой шаблон не отключается и новый не создаётся', async () => {
    await expect(updateTemplate('tpl-b', TEMPLATE_INPUT, { tenantId: 'tenant-a' })).rejects.toMatchObject({ status: 404 });
    expect(m.write).not.toHaveBeenCalled();
  });
});
