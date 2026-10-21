import {beforeEach, describe, expect, it, vi} from 'vitest';

type Row = {
  id: string;
  tenantId: string;
  payload: Record<string, unknown>;
  published: boolean;
};

type Update = {
  where: {id: string; tenantId?: string};
  data: {
    payload?: Record<string, unknown>;
    published?: boolean;
    publishedAt?: Date;
    lastError?: string | null;
  };
};

const h = vi.hoisted(() => ({
  rows: new Map<string, Row>(),
  keys: new Map<string, string>(),
  failPublish: false,
  sendAlert: vi.fn(async () => true),
  get: vi.fn<(key: string) => Promise<string | null>>(),
  set: vi.fn(
    async (key: string, value: string, _mode: string, _ttl: number) => {
      h.keys.set(key, value);
      return 'OK';
    },
  ),
  transaction: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {$transaction: h.transaction},
}));

vi.mock('@/lib/redis-cache', () => ({
  getRedisClient: async () => ({get: h.get, set: h.set}),
}));

vi.mock('@/lib/logger', () => ({
  logger: {warn: vi.fn()},
}));

vi.mock('@/modules/settings', () => ({
  isNotificationEnabled: async () => true,
}));

vi.mock('@/core/notifications/durable-alert', () => ({
  alertSchema: {parse: (data: unknown) => data},
}));

vi.mock('@/core/notifications/telegram-delivery-progress', () => ({
  createTelegramDeliveryProgress: vi.fn(() => ({})),
}));

vi.mock('@/core/notifications/telegram', () => ({
  telegramNotifier: {sendAlert: h.sendAlert},
}));

import {deliverQueuedAlert} from '../durable-alert-delivery';

const tx = {
  $queryRaw: vi.fn(async () => []),
  outboxEvent: {
    findFirst: vi.fn(async ({
      where,
    }: {
      where: {id: string; tenantId: string};
    }) => {
      const row = h.rows.get(where.id);
      return row?.tenantId === where.tenantId
        ? structuredClone(row)
        : null;
    }),

    update: vi.fn(async ({where, data}: Update) => {
      const row = h.rows.get(where.id);
      if (
        !row ||
        (where.tenantId !== undefined && row.tenantId !== where.tenantId)
      ) {
        throw new Error('Row not found');
      }
      if (data.published === true && h.failPublish) {
        h.failPublish = false;
        throw new Error('publication update failed');
      }
      Object.assign(row, structuredClone(data));
      return structuredClone(row);
    }),
  },
};

function queuedEvent(id: string, dedupeKey?: string) {
  h.rows.set(id, {
    id,
    tenantId: 'tenant-1',
    payload: {},
    published: false,
  });
  return {
    id,
    tenantId: 'tenant-1',
    data: {
      message: 'Alert',
      severity: 'critical',
      ...(dedupeKey ? {dedupeKey} : {}),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.rows.clear();
  h.keys.clear();
  h.failPublish = false;
  h.sendAlert.mockResolvedValue(true);
  h.get.mockReset();
  h.get.mockImplementation(async key => h.keys.get(key) ?? null);

  let tail: Promise<void> = Promise.resolve();

  h.transaction.mockImplementation(
    async (work: (client: typeof tx) => Promise<unknown>) => {
      const previous = tail;
      let release: () => void = () => {};
      tail = new Promise<void>(resolve => {
        release = resolve;
      });
      await previous;

      const snapshot = structuredClone(h.rows);
      try {
        return await work(tx);
      } catch (error) {
        h.rows.clear();
        for (const [id, row] of snapshot) h.rows.set(id, row);
        throw error;
      } finally {
        release();
      }
    },
  );
});

describe('XP44 durable alert delivery', () => {
  it('sends once for concurrent events sharing a dedupeKey', async () => {
    const first = queuedEvent('event-a', 'shared-key');
    const second = queuedEvent('event-b', 'shared-key');
    const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

    // Первое событие держит блокировку строки, пока второе не встанет в очередь.
    // (Одновременный первый import() мокнутого модуля в vitest отдаёт второму
    // вызову не мок, поэтому старт второго сдвинут на такт.)
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    h.sendAlert.mockImplementationOnce(async () => {
      await gate;
      return true;
    });

    const firstDone = deliverQueuedAlert(first);
    await tick();
    const secondDone = deliverQueuedAlert(second);
    await tick();
    release();
    await Promise.all([firstDone, secondDone]);

    expect(h.sendAlert).toHaveBeenCalledTimes(1);
    expect(h.rows.get(first.id)?.published).toBe(true);
    expect(h.rows.get(second.id)?.published).toBe(true);
  });

  it('does not resend after publication update fails', async () => {
    const event = queuedEvent('event-retry');
    h.failPublish = true;

    await expect(deliverQueuedAlert(event))
      .rejects.toThrow('publication update failed');

    expect(h.rows.get(event.id)?.published).toBe(false);

    await deliverQueuedAlert(event);

    expect(h.sendAlert).toHaveBeenCalledTimes(1);
    expect(h.rows.get(event.id)?.published).toBe(true);
  });
});
