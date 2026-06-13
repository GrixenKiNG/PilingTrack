import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    pileWork: { findMany: vi.fn(), groupBy: vi.fn() },
    leaderDrilling: { findMany: vi.fn(), groupBy: vi.fn() },
    reportDowntime: { findMany: vi.fn(), groupBy: vi.fn() },
    sitePilePlan: { count: vi.fn(), groupBy: vi.fn() },
    pileGrade: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
    drillingType: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
    downtimeReason: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  deleteDictionaryItem,
  archiveDictionaryItem, restoreDictionaryItem, renameDictionaryItem,
  getDictionaryUsage, listDictionaries,
} from '../dictionary-service';

describe('deleteDictionaryItem (guarded hard delete)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('throws 409 when the pile grade is used in reports', async () => {
    dbMock.pileGrade.findUnique.mockResolvedValue({ id: 'g1', isActive: true });
    dbMock.pileWork.findMany.mockResolvedValue([{ reportId: 'r1' }, { reportId: 'r2' }]);
    dbMock.sitePilePlan.count.mockResolvedValue(0);

    await expect(deleteDictionaryItem('pileGrade', 'g1')).rejects.toMatchObject({ status: 409 });
    expect(dbMock.pileGrade.delete).not.toHaveBeenCalled();
  });

  it('throws 409 when the pile grade is used only in site plans', async () => {
    dbMock.pileGrade.findUnique.mockResolvedValue({ id: 'g1', isActive: true });
    dbMock.pileWork.findMany.mockResolvedValue([]);
    dbMock.sitePilePlan.count.mockResolvedValue(3);

    await expect(deleteDictionaryItem('pileGrade', 'g1')).rejects.toMatchObject({ status: 409 });
    expect(dbMock.pileGrade.delete).not.toHaveBeenCalled();
  });

  it('hard-deletes an unused item', async () => {
    dbMock.pileGrade.findUnique.mockResolvedValue({ id: 'g1', isActive: true });
    dbMock.pileWork.findMany.mockResolvedValue([]);
    dbMock.sitePilePlan.count.mockResolvedValue(0);
    dbMock.pileGrade.delete.mockResolvedValue({ id: 'g1' });

    await expect(deleteDictionaryItem('pileGrade', 'g1')).resolves.toEqual({ success: true });
    expect(dbMock.pileGrade.delete).toHaveBeenCalledWith({ where: { id: 'g1' } });
  });

  it('throws 404 when the item does not exist', async () => {
    dbMock.drillingType.findUnique.mockResolvedValue(null);
    await expect(deleteDictionaryItem('drillingType', 'x')).rejects.toMatchObject({ status: 404 });
  });
});

describe('archive/restore/rename', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('archive sets isActive false', async () => {
    dbMock.pileGrade.findUnique.mockResolvedValue({ id: 'g1', isActive: true });
    dbMock.pileGrade.update.mockResolvedValue({ id: 'g1', isActive: false });
    await archiveDictionaryItem('pileGrade', 'g1');
    expect(dbMock.pileGrade.update).toHaveBeenCalledWith({ where: { id: 'g1' }, data: { isActive: false } });
  });

  it('restore sets isActive true', async () => {
    dbMock.downtimeReason.findUnique.mockResolvedValue({ id: 'd1', isActive: false });
    dbMock.downtimeReason.update.mockResolvedValue({ id: 'd1', isActive: true });
    await restoreDictionaryItem('downtimeReason', 'd1');
    expect(dbMock.downtimeReason.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { isActive: true } });
  });

  it('rename trims and updates the name', async () => {
    dbMock.drillingType.findUnique.mockResolvedValue({ id: 't1', name: 'old' });
    dbMock.drillingType.update.mockResolvedValue({ id: 't1', name: 'new' });
    await renameDictionaryItem('drillingType', 't1', '  new  ');
    expect(dbMock.drillingType.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { name: 'new' } });
  });

  it('rename rejects an empty name', async () => {
    await expect(renameDictionaryItem('drillingType', 't1', '   ')).rejects.toMatchObject({ status: 400 });
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

    const usage = await getDictionaryUsage();
    expect(usage.pileGrade.g1).toEqual({ reportCount: 2, planCount: 0 });
    expect(usage.pileGrade.g2).toEqual({ reportCount: 1, planCount: 0 });
    expect(usage.pileGrade.g3).toEqual({ reportCount: 0, planCount: 4 });
    expect(usage.drillingType.t1).toEqual({ reportCount: 1, planCount: 0 });
  });
});

describe('listDictionaries', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('filters by archived', async () => {
    dbMock.pileGrade.findMany.mockResolvedValue([]);
    dbMock.drillingType.findMany.mockResolvedValue([]);
    dbMock.downtimeReason.findMany.mockResolvedValue([]);
    await listDictionaries('archived');
    expect(dbMock.pileGrade.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: false } }));
  });

  it('does not filter for "all"', async () => {
    dbMock.pileGrade.findMany.mockResolvedValue([]);
    dbMock.drillingType.findMany.mockResolvedValue([]);
    dbMock.downtimeReason.findMany.mockResolvedValue([]);
    await listDictionaries('all');
    expect(dbMock.pileGrade.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});
