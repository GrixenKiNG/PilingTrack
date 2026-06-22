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
    update: vi.fn().mockResolvedValue({}),
  },
  reportDowntime: { deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({}) },
  pileWork: { deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({}) },
  leaderDrilling: { deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({}) },
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
