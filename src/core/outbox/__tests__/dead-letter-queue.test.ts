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
  mockUpdateMany: vi.fn().mockResolvedValue({ count: 1 }),
  mockSendMessage: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/core/notifications/telegram', () => ({
  telegramNotifier: { sendMessage: mocks.mockSendMessage },
}));

vi.mock('@/lib/db', () => {
  const client = {
    deadLetterQueue: {
      create: mocks.mockCreate,
      update: mocks.mockUpdate,
      findUnique: mocks.mockFindUnique,
      findMany: mocks.mockFindMany,
      count: mocks.mockCount,
      updateMany: mocks.mockUpdateMany,
    },
    outboxEvent: {
      update: mocks.mockOutboxUpdate,
      create: mocks.mockOutboxCreate,
    },
    $transaction: (fn: (tx: unknown) => unknown) => fn(client),
  };
  return { db: client };
});

const ORIGIN = { tenantId: 'orion', aggregateType: 'Report', consumer: 'published' as const };

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
      5,
      ORIGIN,
    );

    expect(mocks.mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'ReportCreated',
        aggregateId: 'report-123',
        attempts: 5,
        sourceOutboxId: 'outbox-1',
        tenantId: 'orion',
        consumer: 'published',
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
    expect(mocks.mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 'dlq-1', status: 'pending' },
      data: { status: 'resolved' },
    });
  });

  it('экранирует подстановки HTML в алерте, сохраняя исходную ошибку в DLQ', async () => {
    const errorMessage = 'Ошибка <record> & повтор ' + 'я'.repeat(210);
    await moveToDlq('outbox-html', 'Event<created>&', 'aggregate<&>', {}, new Error(errorMessage), 5, ORIGIN);

    await vi.waitFor(() => expect(mocks.mockSendMessage).toHaveBeenCalled());
    const text = mocks.mockSendMessage.mock.calls[0][0] as string;
    expect(text).toContain('<code>Event&lt;created&gt;&amp;</code>');
    expect(text).toContain('<code>aggregate&lt;&amp;&gt;</code>');
    expect(text).toContain('<code>Ошибка &lt;record&gt; &amp; повтор ');
    expect(text).not.toContain('<record>');
    expect(mocks.mockCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ errorMessage }) });
    const errorText = text.match(/Ошибка: <code>(.*)<\/code>$/)?.[1]
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    expect(errorText).toBe(errorMessage.substring(0, 200));
  });

  it('сохраняет запись DLQ, когда уведомление Telegram отклонено', async () => {
    mocks.mockSendMessage.mockRejectedValueOnce(new Error('Telegram unavailable'));
    await moveToDlq('outbox-offline', 'ReportCreated', null, {}, new Error('failure'), 5, ORIGIN);

    await vi.waitFor(() => expect(mocks.mockSendMessage).toHaveBeenCalled());
    expect(mocks.mockCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ sourceOutboxId: 'outbox-offline' }) });
  });

  it('повтор сохраняет организацию и будит только упавшего потребителя', async () => {
    mocks.mockFindUnique.mockResolvedValue({
      id: 'dlq-1', eventType: 'ReportSubmitted', aggregateId: 'report-123',
      payload: { id: 'report-123' }, status: 'resolved',
      tenantId: 'orion', aggregateType: 'Equipment', consumer: 'projected',
    });

    await retryDlqEntry('dlq-1');

    // Без tenantId обработчик идёт в базу без организации и под RLS видит пустоту;
    // без published:true повтор проекции заново разослал бы уведомления.
    expect(mocks.mockOutboxCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'orion', aggregateType: 'Equipment', published: true, projected: false,
      }),
    });
  });

  it('повтор уже взятой записи ничего не ставит в очередь', async () => {
    mocks.mockUpdateMany.mockResolvedValueOnce({ count: 0 });

    expect(await retryDlqEntry('dlq-1')).toBe(false);
    expect(mocks.mockOutboxCreate).not.toHaveBeenCalled();
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
