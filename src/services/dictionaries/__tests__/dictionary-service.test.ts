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
    report: { findMany: vi.fn() },
  },
  auditMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/services/audit/audit-service', () => ({ recordAuditEvent: auditMock }));

import {
  deleteDictionaryItem,
  archiveDictionaryItem, restoreDictionaryItem, renameDictionaryItem,
  createDictionaryItem, getDictionaryUsage, listActiveDictionaries, listDictionaries,
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

    await listActiveDictionaries(tenantId);

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
    dbMock.pileWork.findMany.mockResolvedValue([{ reportId: 'r1', report: { siteId: 's1' } }, { reportId: 'r2', report: { siteId: 's1' } }]);
    dbMock.sitePilePlan.count.mockResolvedValue(0);

    await expect(deleteDictionaryItem(mutation, 'pileGrade', 'g1')).rejects.toMatchObject({ status: 409 });
    expect(dbMock.pileGrade.delete).not.toHaveBeenCalled();
  });

  it('throws 409 when the pile grade is used only in site plans', async () => {
    dbMock.pileGrade.findFirst.mockResolvedValue({ id: 'g1', isActive: true });
    dbMock.pileWork.findMany.mockResolvedValue([]);
    dbMock.sitePilePlan.count.mockResolvedValue(3);

    await expect(deleteDictionaryItem(mutation, 'pileGrade', 'g1')).rejects.toMatchObject({ status: 409 });
    expect(dbMock.pileGrade.delete).not.toHaveBeenCalled();
  });

  it('hard-deletes an unused item', async () => {
    dbMock.pileGrade.findFirst.mockResolvedValue({ id: 'g1', isActive: true });
    dbMock.pileWork.findMany.mockResolvedValue([]);
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
    expect(dbMock.pileGrade.update).toHaveBeenCalledWith({ where: { id: 'g1', tenantId }, data: { isActive: false } });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'dictionary.archived', targetId: 'g1', tenantId, actorId: 'admin-a',
    }));
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
    dbMock.leaderDrilling.findMany.mockResolvedValue([]);
    await renameDictionaryItem(mutation, 'drillingType', 't1', '  new  ');
    expect(dbMock.drillingType.update).toHaveBeenCalledWith({ where: { id: 't1', tenantId }, data: { name: 'new', normalizedName: 'new' } });
  });

  it('rename rejects an empty name', async () => {
    await expect(renameDictionaryItem(mutation, 'drillingType', 't1', '   ')).rejects.toMatchObject({ status: 400 });
  });

  it('rejects rename when the item is already used', async () => {
    dbMock.drillingType.findFirst.mockResolvedValue({ id: 't1', name: 'old', isActive: true });
    dbMock.leaderDrilling.findMany.mockResolvedValue([{ reportId: 'r1', report: { siteId: 's1' } }]);

    await expect(renameDictionaryItem(mutation, 'drillingType', 't1', 'new'))
      .rejects.toMatchObject({ status: 409 });
    expect(dbMock.drillingType.update).not.toHaveBeenCalled();
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
