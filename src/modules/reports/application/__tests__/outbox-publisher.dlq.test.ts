/**
 * Издатель outbox — сбой записи в DLQ не должен терять событие (находка Codex XP45).
 *
 * Когда событие исчерпало попытки, издатель переносит его в DLQ и только затем
 * помечает строку обработанной. Если запись в DLQ не удалась, строку помечать
 * нельзя: иначе событие нет ни в DLQ, ни в очереди повтора. Сбой одного события
 * не должен останавливать обработку остальных событий пачки.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  moveToDlq: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    outboxEvent: {
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
      update: mocks.update,
      updateMany: mocks.updateMany,
    },
  },
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: mocks.loggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/core/outbox/dead-letter-queue', () => ({ moveToDlq: mocks.moveToDlq }));
vi.mock('@/core/outbox/outbox-stats', () => ({ MAX_OUTBOX_RETRIES: 5, getOutboxStats: vi.fn() }));
vi.mock('@/core/notifications/durable-alert', () => ({ ALERT_DELIVERY_EVENT: 'NotificationDeliveryRequested' }));

import { publishOutboxEvents } from '../outbox-publisher';

function row(id: string, attempts: number) {
  return {
    id,
    type: 'ReportCreated',
    aggregateId: `agg-${id}`,
    aggregateType: 'Report',
    tenantId: 'tenant-1',
    payload: {},
    attempts,
    occurredAt: new Date('2026-10-01T10:00:00.000Z'),
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
  };
}

describe('publishOutboxEvents: сбой записи в DLQ', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((fn) => fn.mockReset());
    mocks.findUnique.mockResolvedValue({ payload: {} });
    mocks.update.mockResolvedValue({});
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it('не помечает строку обработанной, если событие не удалось записать в DLQ', async () => {
    // Последняя попытка: событие должно уйти в DLQ.
    mocks.findMany.mockResolvedValue([row('e1', 4)]);
    mocks.moveToDlq.mockRejectedValue(new Error('DLQ insert rejected'));

    const processed = await publishOutboxEvents(async () => { throw new Error('handler failed'); });

    expect(processed).toBe(0);
    expect(mocks.moveToDlq).toHaveBeenCalledTimes(1);
    // Строка осталась необработанной: ни attempts, ни published не записаны.
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.loggerError).toHaveBeenCalled();
  });

  it('помечает строку обработанной, когда запись в DLQ прошла', async () => {
    mocks.findMany.mockResolvedValue([row('e1', 4)]);
    mocks.moveToDlq.mockResolvedValue(undefined);

    await publishOutboxEvents(async () => { throw new Error('handler failed'); });

    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({ published: true, attempts: 5 });
  });

  it('сбой DLQ у одного события не останавливает остальные события пачки', async () => {
    mocks.findMany.mockResolvedValue([row('bad', 4), row('good', 0)]);
    mocks.moveToDlq.mockRejectedValue(new Error('DLQ insert rejected'));
    const handler = vi.fn(async (event: { id: string }) => {
      if (event.id === 'bad') throw new Error('handler failed');
    });

    const processed = await publishOutboxEvents(handler as never);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(processed).toBe(1);
  });
});
