/**
 * Report Repository — optimistic-concurrency guard
 *
 * The guard lives INSIDE the save transaction so the version it checks is the
 * one actually being written against (race-free). These tests drive save()
 * with a faked interactive transaction and assert the 409 behaviour.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReportAggregate } from '../../domain';

// Fake interactive-transaction client. save() only touches these methods.
const tx = {
  report: {
    findUnique: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
  },
  reportDowntime: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}), deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({}) },
  pileWork: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}), deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({}) },
  leaderDrilling: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}), deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({}) },
  outboxEvent: { createMany: vi.fn().mockResolvedValue({}) },
  reportVersion: { create: vi.fn().mockResolvedValue({}) },
};

vi.mock('@/lib/db', () => ({
  DEFAULT_TX_OPTIONS: {},
  db: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test transaction shim
    $transaction: (cb: any) => cb(tx),
  },
}));

import { PrismaReportRepository } from '../report.repository';

function makeUpdateAggregate(): ReportAggregate {
  const aggregate = ReportAggregate.create({
    reportId: 'rep-1',
    userId: 'user-1',
    siteId: 'site-1',
    date: '2026-04-05',
  });
  aggregate.addPileWork({ pileGradeId: 'grade-1', count: 2 }, 'user-1');
  aggregate.submit('user-1');
  return aggregate;
}

describe('PrismaReportRepository optimistic concurrency', () => {
  const repo = new PrismaReportRepository();

  beforeEach(() => {
    vi.clearAllMocks();
    // Existing row is at version 5 for every test unless overridden.
    tx.report.findUnique.mockResolvedValue({ id: 'rep-internal', version: 5 });
  });

  it('rejects with 409 when the stored version moved past expectedVersion', async () => {
    await expect(
      repo.save(makeUpdateAggregate(), { expectedVersion: 3 }),
    ).rejects.toMatchObject({ status: 409 });

    // Guard fires before any write happens.
    expect(tx.reportVersion.create).not.toHaveBeenCalled();
  });

  it('saves when expectedVersion matches the stored version', async () => {
    await expect(
      repo.save(makeUpdateAggregate(), { expectedVersion: 5 }),
    ).resolves.toBeUndefined();

    expect(tx.reportVersion.create).toHaveBeenCalledTimes(1);
  });

  it('skips the check (last-write-wins) when expectedVersion is undefined', async () => {
    tx.report.findUnique.mockResolvedValue({ id: 'rep-internal', version: 99 });

    await expect(
      repo.save(makeUpdateAggregate(), {}),
    ).resolves.toBeUndefined();

    expect(tx.reportVersion.create).toHaveBeenCalledTimes(1);
  });
});

describe('report save regression', () => {
  const repo = new PrismaReportRepository();
  beforeEach(() => { vi.clearAllMocks(); tx.report.findUnique.mockResolvedValue({id:'rep-internal', version:5, tenantId:'orion', shiftId:'shift-1'}); });
  it('rejects a concurrent version claim before changing any work', async () => {
    tx.report.updateMany.mockResolvedValueOnce({count: 0});
    await expect(repo.save(makeUpdateAggregate(), {expectedVersion: 5})).rejects.toMatchObject({status:409});
    expect(tx.pileWork.deleteMany).not.toHaveBeenCalled();
    expect(tx.reportVersion.create).not.toHaveBeenCalled();
  });
  it('preserves work identity and server-derived tenant/shift', async () => {
    tx.pileWork.findMany.mockResolvedValueOnce([{id:'work-1', pileGradeId:'grade-1', count:1, picketId:null}]);
    await repo.save(makeUpdateAggregate(), {expectedVersion:5});
    expect(tx.pileWork.deleteMany).not.toHaveBeenCalled();
    expect(tx.pileWork.create).not.toHaveBeenCalled();
    expect(tx.pileWork.update).toHaveBeenCalledWith({where:{id:'work-1'},data:{pileGradeId:'grade-1',count:2,picketId:null,tenantId:'orion',shiftId:'shift-1'}});
  });
  it('creates without querying a removed natural unique key', async () => {
    tx.report.findUnique.mockResolvedValue(null);
    await repo.save(makeUpdateAggregate());
    expect(tx.report.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.report.create).toHaveBeenCalledTimes(1);
  });
});
