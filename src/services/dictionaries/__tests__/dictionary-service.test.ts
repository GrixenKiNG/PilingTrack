import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock, auditMock } = vi.hoisted(() => ({
  dbMock: {
    pileWork: { findMany: vi.fn(), groupBy: vi.fn() },
    leaderDrilling: { findMany: vi.fn(), groupBy: vi.fn() },
    reportDowntime: { findMany: vi.fn(), groupBy: vi.fn() },
    sitePilePlan: { count: vi.fn(), groupBy: vi.fn() },
    pileGrade: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
    drillingType: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
    downtimeReason: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
    report: { findMany: vi.fn(), groupBy: vi.fn() },
  },
  auditMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/services/audit/audit-service', () => ({ recordAuditEvent: auditMock }));

import {
  deleteDictionaryItem,
  archiveDictionaryItem, restoreDictionaryItem, renameDictionaryItem,
  createDictionaryItem, getDictionaryUsage, getItemUsage, listDictionaries, setPileGradeLength,
} from '../dictionary-service';

const tenantId = 'tenant-a';
const mutation = { tenantId, actorId: 'admin-a' };

describe('tenant isolation', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates a pile grade with explicit authoritative length', async () => {
    dbMock.pileGrade.create.mockResolvedValue({ id: 'g1' });

    await createDictionaryItem(mutation, 'pileGrade', {
      name: '  СВ 120-35  ', code: 'СВ120', lengthMm: 12_000,
    });

    expect(dbMock.pileGrade.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      tenantId,
      name: 'СВ 120-35',
      normalizedName: 'св 120-35',
      code: 'СВ120',
      lengthMm: 12_000,
    }) });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'dictionary.created', tenantId, actorId: 'admin-a', targetId: 'g1',
    }));
  });

  it('lists only active values owned by the tenant', async () => {
    dbMock.pileGrade.findMany.mockResolvedValue([]);
    dbMock.drillingType.findMany.mockResolvedValue([]);
    dbMock.downtimeReason.findMany.mockResolvedValue([]);

    await listDictionaries(tenantId, 'active');

    expect(dbMock.pileGrade.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId, isActive: true },
    }));
  });

  it('returns 404 instead of mutating an item from another tenant', async () => {
    dbMock.pileGrade.findFirst.mockResolvedValue(null);

    await expect(archiveDictionaryItem(mutation, 'pileGrade', 'foreign'))
      .rejects.toMatchObject({ status: 404 });
    expect(dbMock.pileGrade.update).not.toHaveBeenCalled();
  });
});

describe('deleteDictionaryItem (guarded hard delete)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('throws 409 when the pile grade is used in reports', async () => {
    dbMock.pileGrade.findFirst.mockResolvedValue({ id: 'g1', isActive: true });
    dbMock.report.groupBy.mockResolvedValue([{ siteId: 's1', _count: { _all: 2 } }]);
    dbMock.sitePilePlan.count.mockResolvedValue(0);

    await expect(deleteDictionaryItem(mutation, 'pileGrade', 'g1')).rejects.toMatchObject({ status: 409 });
    expect(dbMock.pileGrade.delete).not.toHaveBeenCalled();
  });

  it('throws 409 when the pile grade is used only in site plans', async () => {
    dbMock.pileGrade.findFirst.mockResolvedValue({ id: 'g1', isActive: true });
    dbMock.report.groupBy.mockResolvedValue([]);
    dbMock.sitePilePlan.count.mockResolvedValue(3);

    await expect(deleteDictionaryItem(mutation, 'pileGrade', 'g1')).rejects.toMatchObject({ status: 409 });
    expect(dbMock.pileGrade.delete).not.toHaveBeenCalled();
  });

  it('hard-deletes an unused item', async () => {
    dbMock.pileGrade.findFirst.mockResolvedValue({ id: 'g1', isActive: true });
    dbMock.report.groupBy.mockResolvedValue([]);
    dbMock.sitePilePlan.count.mockResolvedValue(0);
    dbMock.pileGrade.delete.mockResolvedValue({ id: 'g1' });

    await expect(deleteDictionaryItem(mutation, 'pileGrade', 'g1')).resolves.toEqual({ success: true });
    expect(dbMock.pileGrade.delete).toHaveBeenCalledWith({ where: { id: 'g1', tenantId } });
  });

  it('throws 404 when the item does not exist', async () => {
    dbMock.drillingType.findFirst.mockResolvedValue(null);
    await expect(deleteDictionaryItem(mutation, 'drillingType', 'x')).rejects.toMatchObject({ status: 404 });
  });
});

describe('archive/restore/rename', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('archive sets isActive false', async () => {
    dbMock.pileGrade.findFirst.mockResolvedValue({ id: 'g1', isActive: true });
    dbMock.pileGrade.update.mockResolvedValue({ id: 'g1', isActive: false });
    await archiveDictionaryItem(mutation, 'pileGrade', 'g1');
    expect(dbMock.pileGrade.update).toHaveBeenCalledWith({ where: { id: 'g1', tenantId }, data: { isActive: false, archivedAt: expect.any(Date) } });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'dictionary.archived', targetId: 'g1', tenantId, actorId: 'admin-a',
    }));
  });

  it('re-archiving an archived grade keeps its archive time', async () => {
    dbMock.pileGrade.findFirst.mockResolvedValue({ id: 'g1', isActive: false });
    dbMock.pileGrade.update.mockResolvedValue({ id: 'g1', isActive: false });
    await archiveDictionaryItem(mutation, 'pileGrade', 'g1');
    expect(dbMock.pileGrade.update).toHaveBeenCalledWith({ where: { id: 'g1', tenantId }, data: { isActive: false } });
  });

  it('restore sets isActive true', async () => {
    dbMock.downtimeReason.findFirst.mockResolvedValue({ id: 'd1', isActive: false });
    dbMock.downtimeReason.update.mockResolvedValue({ id: 'd1', isActive: true });
    await restoreDictionaryItem(mutation, 'downtimeReason', 'd1');
    expect(dbMock.downtimeReason.update).toHaveBeenCalledWith({ where: { id: 'd1', tenantId }, data: { isActive: true } });
  });

  it('rename trims and updates the name', async () => {
    dbMock.drillingType.findFirst.mockResolvedValue({ id: 't1', name: 'old' });
    dbMock.drillingType.update.mockResolvedValue({ id: 't1', name: 'new' });
    dbMock.report.groupBy.mockResolvedValue([]);
    await renameDictionaryItem(mutation, 'drillingType', 't1', '  new  ');
    expect(dbMock.drillingType.update).toHaveBeenCalledWith({ where: { id: 't1', tenantId }, data: { name: 'new', normalizedName: 'new' } });
  });

  it('rename rejects an empty name', async () => {
    await expect(renameDictionaryItem(mutation, 'drillingType', 't1', '   ')).rejects.toMatchObject({ status: 400 });
  });

  it('rejects rename when the item is already used', async () => {
    dbMock.drillingType.findFirst.mockResolvedValue({ id: 't1', name: 'old', isActive: true });
    dbMock.report.groupBy.mockResolvedValue([{ siteId: 's1', _count: { _all: 1 } }]);

    await expect(renameDictionaryItem(mutation, 'drillingType', 't1', 'new'))
      .rejects.toMatchObject({ status: 409 });
    expect(dbMock.drillingType.update).not.toHaveBeenCalled();
  });
});

/*
  Использование элемента справочника теперь считает БД (GROUP BY siteId), а не JS.
  Фикстура из «того же» набора строк: три отчёта на двух объектах, из них два
  в s1 и один в s2 — счётчики обязаны остаться прежними.
*/
describe('getItemUsage (counts computed by the database)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('keeps report and object counts for a small fixture', async () => {
    dbMock.report.groupBy.mockResolvedValue([
      { siteId: 's1', _count: { _all: 2 } },
      { siteId: 's2', _count: { _all: 1 } },
    ]);
    dbMock.sitePilePlan.count.mockResolvedValue(4);

    await expect(getItemUsage(tenantId, 'pileGrade', 'g1')).resolves.toEqual({
      reportCount: 3, planCount: 4, siteCount: 2,
    });
    expect(dbMock.report.groupBy).toHaveBeenCalledWith({
      by: ['siteId'],
      where: { tenantId, piles: { some: { pileGradeId: 'g1' } } },
      _count: { _all: true },
    });
    expect(dbMock.pileWork.findMany).not.toHaveBeenCalled();
  });

  it('scopes drilling and downtime usage to the tenant', async () => {
    dbMock.report.groupBy.mockResolvedValue([{ siteId: 's1', _count: { _all: 1 } }]);

    await expect(getItemUsage(tenantId, 'drillingType', 't1')).resolves.toEqual({ reportCount: 1, planCount: 0, siteCount: 1 });
    await expect(getItemUsage(tenantId, 'downtimeReason', 'd1')).resolves.toEqual({ reportCount: 1, planCount: 0, siteCount: 1 });

    expect(dbMock.report.groupBy).toHaveBeenNthCalledWith(1, {
      by: ['siteId'],
      where: { tenantId, drillings: { some: { typeId: 't1' } } },
      _count: { _all: true },
    });
    expect(dbMock.report.groupBy).toHaveBeenNthCalledWith(2, {
      by: ['siteId'],
      where: { tenantId, downtimes: { some: { reasonId: 'd1' } } },
      _count: { _all: true },
    });
    expect(dbMock.leaderDrilling.findMany).not.toHaveBeenCalled();
    expect(dbMock.reportDowntime.findMany).not.toHaveBeenCalled();
    await expect(getItemUsage('', 'pileGrade', 'g1')).rejects.toMatchObject({ status: 403 });
  });
});

/*
  Длина марки не хранится в отчёте: её берут живьём аналитика объекта и техники,
  журнал забивки и печатные формы за прошлые периоды. Ноль обнулил бы погонные
  метры везде и задним числом, поэтому отказ обязан быть на сервере, а не только
  в форме.
*/
describe('setPileGradeLength', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('rejects a zero length for an unused grade', async () => {
    dbMock.pileGrade.findFirst.mockResolvedValue({ id: 'g1', lengthMm: 12000 });
    dbMock.report.groupBy.mockResolvedValue([]);
    dbMock.sitePilePlan.count.mockResolvedValue(0);

    await expect(setPileGradeLength(mutation, 'g1', 0)).rejects.toMatchObject({ status: 400 });
    expect(dbMock.pileGrade.update).not.toHaveBeenCalled();
  });

  it('keeps null as an unset length for an unused grade', async () => {
    dbMock.pileGrade.findFirst.mockResolvedValue({ id: 'g1', lengthMm: 12000 });
    dbMock.report.groupBy.mockResolvedValue([]);
    dbMock.sitePilePlan.count.mockResolvedValue(0);
    dbMock.pileGrade.update.mockResolvedValue({ id: 'g1', lengthMm: null });
    await setPileGradeLength(mutation, 'g1', null);
    expect(dbMock.pileGrade.update).toHaveBeenCalledWith({ where: { id: 'g1', tenantId }, data: { lengthMm: null } });
  });

  it('refuses to change the length of a used grade without confirmation', async () => {
    dbMock.pileGrade.findFirst.mockResolvedValue({ id: 'g1', lengthMm: 12000 });
    dbMock.report.groupBy.mockResolvedValue([{ siteId: 's1', _count: { _all: 3 } }]);
    dbMock.sitePilePlan.count.mockResolvedValue(0);

    await expect(setPileGradeLength(mutation, 'g1', 15000)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('используется в 3 отчётах'),
    });
    expect(dbMock.pileGrade.update).not.toHaveBeenCalled();
  });

  it('refuses to clear the length of a used grade', async () => {
    dbMock.pileGrade.findFirst.mockResolvedValue({ id: 'g1', lengthMm: 12000 });
    dbMock.report.groupBy.mockResolvedValue([{ siteId: 's1', _count: { _all: 2 } }]);
    dbMock.sitePilePlan.count.mockResolvedValue(0);

    await expect(setPileGradeLength(mutation, 'g1', null)).rejects.toMatchObject({ status: 422 });
    expect(dbMock.pileGrade.update).not.toHaveBeenCalled();
  });

  it('applies the change of a used grade when recalculate is confirmed', async () => {
    dbMock.pileGrade.findFirst.mockResolvedValue({ id: 'g1', lengthMm: 12000 });
    dbMock.report.groupBy.mockResolvedValue([{ siteId: 's1', _count: { _all: 2 } }]);
    dbMock.sitePilePlan.count.mockResolvedValue(0);
    dbMock.pileGrade.update.mockResolvedValue({ id: 'g1', lengthMm: 15000 });

    await setPileGradeLength(mutation, 'g1', 15000, true);
    expect(dbMock.pileGrade.update).toHaveBeenCalledWith({ where: { id: 'g1', tenantId }, data: { lengthMm: 15000 } });
  });
});

describe('getDictionaryUsage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('counts distinct reports per item and plan counts for pile grades', async () => {
    dbMock.pileWork.groupBy.mockResolvedValue([
      { pileGradeId: 'g1', reportId: 'r1' }, { pileGradeId: 'g1', reportId: 'r2' }, { pileGradeId: 'g2', reportId: 'r1' },
    ]);
    dbMock.leaderDrilling.groupBy.mockResolvedValue([{ typeId: 't1', reportId: 'r1' }]);
    dbMock.reportDowntime.groupBy.mockResolvedValue([]);
    dbMock.sitePilePlan.groupBy.mockResolvedValue([{ pileGradeId: 'g3', _count: { _all: 4 } }]);

    dbMock.pileGrade.findMany.mockResolvedValue([{ id: 'g1' }, { id: 'g2' }, { id: 'g3' }]);
    dbMock.drillingType.findMany.mockResolvedValue([{ id: 't1' }]);
    dbMock.downtimeReason.findMany.mockResolvedValue([]);
    dbMock.report.findMany.mockResolvedValue([{ id: 'r1', siteId: 's1' }, { id: 'r2', siteId: 's2' }]);

    const usage = await getDictionaryUsage(tenantId);
    expect(usage.pileGrade.g1).toEqual({ reportCount: 2, planCount: 0, siteCount: 2 });
    expect(usage.pileGrade.g2).toEqual({ reportCount: 1, planCount: 0, siteCount: 1 });
    expect(usage.pileGrade.g3).toEqual({ reportCount: 0, planCount: 4, siteCount: 0 });
    expect(usage.drillingType.t1).toEqual({ reportCount: 1, planCount: 0, siteCount: 1 });
    expect(usage.siteTotals).toEqual({ pileGrade: 2, drillingType: 1, downtimeReason: 0 });
  });
});

describe('listDictionaries', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('filters by archived', async () => {
    dbMock.pileGrade.findMany.mockResolvedValue([]);
    dbMock.drillingType.findMany.mockResolvedValue([]);
    dbMock.downtimeReason.findMany.mockResolvedValue([]);
    await listDictionaries(tenantId, 'archived');
    expect(dbMock.pileGrade.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId, isActive: false } }));
  });

  it('does not filter for "all"', async () => {
    dbMock.pileGrade.findMany.mockResolvedValue([]);
    dbMock.drillingType.findMany.mockResolvedValue([]);
    dbMock.downtimeReason.findMany.mockResolvedValue([]);
    await listDictionaries(tenantId, 'all');
    expect(dbMock.pileGrade.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId } }));
  });
});
