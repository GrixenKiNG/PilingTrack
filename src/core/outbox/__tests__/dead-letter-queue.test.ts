/**
 * Dead Letter Queue — Integration Tests
 *
 * Tests DLQ lifecycle: moveToDlq → retry → resolve
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { moveToDlq, retryDlqEntry, discardDlqEntry, getDlqStats, getPendingDlqEntries } from '../dead-letter-queue';

// Mock db — use vi.hoisted to define mocks BEFORE vi.mock is hoisted
const mocks = vi.hoisted(() => ({
  mockCreate: vi.fn().mockResolvedValue({ id: 'dlq-1' }),
  mockUpdate: vi.fn().mockResolvedValue({}),
  mockFindUnique: vi.fn(),
  mockFindMany: vi.fn().mockResolvedValue([]),
  mockCount: vi.fn().mockResolvedValue(0),
  mockOutboxUpdate: vi.fn().mockResolvedValue({}),
  mockOutboxCreate: vi.fn().mockResolvedValue({ id: 'outbox-1' }),
}));

vi.mock('@/lib/db', () => ({
  db: {
    deadLetterQueue: {
      create: mocks.mockCreate,
      update: mocks.mockUpdate,
      findUnique: mocks.mockFindUnique,
      findMany: mocks.mockFindMany,
      count: mocks.mockCount,
    },
    outboxEvent: {
      update: mocks.mockOutboxUpdate,
      create: mocks.mockOutboxCreate,
    },
  },
}));

describe('Dead Letter Queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('moves failed event to DLQ', async () => {
    await moveToDlq(
      'outbox-1',
      'ReportCreated',
      'report-123',
      { id: 'report-123', status: 'draft' },
      new Error('Database connection timeout'),
      5
    );

    expect(mocks.mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'ReportCreated',
        aggregateId: 'report-123',
        attempts: 5,
        sourceOutboxId: 'outbox-1',
      }),
    });

    // moveToDlq must NOT touch OutboxEvent — that's the caller's job.
    // Setting published=false here previously caused infinite re-queueing.
    expect(mocks.mockOutboxUpdate).not.toHaveBeenCalled();
  });

  it('retries DLQ entry by re-inserting into outbox', async () => {
    mocks.mockFindUnique.mockResolvedValue({
      id: 'dlq-1',
      eventType: 'ReportCreated',
      aggregateId: 'report-123',
      payload: { id: 'report-123' },
      status: 'pending',
    });

    const result = await retryDlqEntry('dlq-1');

    expect(result).toBe(true);
    expect(mocks.mockUpdate).toHaveBeenCalledWith({
      where: { id: 'dlq-1' },
      data: { status: 'resolved' },
    });
  });

  it('discards DLQ entry', async () => {
    await discardDlqEntry('dlq-1');

    expect(mocks.mockUpdate).toHaveBeenCalledWith({
      where: { id: 'dlq-1' },
      data: { status: 'discarded' },
    });
  });

  it('returns DLQ stats', async () => {
    mocks.mockCount.mockImplementation(({ where }: { where: { status: string } }) => {
      if (where.status === 'pending') return Promise.resolve(5);
      if (where.status === 'resolved') return Promise.resolve(10);
      if (where.status === 'discarded') return Promise.resolve(2);
      return Promise.resolve(0);
    });

    const stats = await getDlqStats();

    expect(stats).toEqual({
      pending: 5,
      resolved: 10,
      discarded: 2,
      total: 17,
    });
  });

  it('returns pending DLQ entries', async () => {
    mocks.mockFindMany.mockResolvedValue([
      { id: 'dlq-1', eventType: 'ReportCreated', status: 'pending' },
      { id: 'dlq-2', eventType: 'ReportUpdated', status: 'pending' },
    ]);

    const entries = await getPendingDlqEntries(10);

    expect(entries).toHaveLength(2);
    expect(mocks.mockFindMany).toHaveBeenCalledWith({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
  });
});
