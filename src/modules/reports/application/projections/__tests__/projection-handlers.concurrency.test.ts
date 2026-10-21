/**
 * Недельный тренд объекта — старый пересчёт не затирает новый (находка Codex XP37).
 *
 * Пересчёт читал дневные сводки и писал тренд без транзакции и замка: расчёт,
 * начавшийся раньше и прочитавший старые данные, мог записаться последним и
 * затереть результат более нового. Теперь чтение и запись идут одной
 * транзакцией под advisory-замком на объект и неделю, взятым до чтения.
 */
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  site: vi.fn(),
  daily: vi.fn(),
  upsert: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    site: { findUnique: mocks.site },
    siteDailySummary: { findMany: mocks.daily },
    siteWeeklyTrend: { upsert: mocks.upsert },
    $transaction: mocks.transaction,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn() },
}));

vi.mock('@/core/security/tenant-context', () => ({
  getRequestTenantId: () => 'tenant-1',
}));

import { projectWeeklyTrend } from '../projection-handlers';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
});

it('не позволяет старому пересчёту затереть результат нового', async () => {
  const firstRead = deferred();
  const releaseFirstRead = deferred();
  const secondReached = deferred();

  let sourcePiles = 10;
  let storedPiles: number | undefined;
  let reads = 0;
  let lockCalls = 0;
  let lockTail: Promise<void> = Promise.resolve();

  mocks.site.mockResolvedValue({ tenantId: 'tenant-1' });

  mocks.daily.mockImplementation(async () => {
    // Снимок фиксируется до паузы: A уже прочитал старые данные.
    const snapshot = [{
      date: '2026-10-19',
      totalPiles: sourcePiles,
      totalDrilling: 0,
      totalDowntime: 0,
      reportCount: 1,
    }];

    if (++reads === 1) {
      firstRead.resolve();
      await releaseFirstRead.promise;
    }

    return snapshot;
  });

  mocks.upsert.mockImplementation(async (args: {
    update: { totalPiles: number };
  }) => {
    storedPiles = args.update.totalPiles;

    // На текущем коде B достигает записи без блокировки.
    if (storedPiles === 20) secondReached.resolve();

    return {};
  });

  type TestTx = {
    site: { findUnique: typeof mocks.site };
    siteDailySummary: { findMany: typeof mocks.daily };
    siteWeeklyTrend: { upsert: typeof mocks.upsert };
    $executeRaw: () => Promise<number>;
  };

  mocks.transaction.mockImplementation(
    async (work: (tx: TestTx) => Promise<unknown>) => {
      let unlock: (() => void) | undefined;

      const tx: TestTx = {
        site: { findUnique: mocks.site },
        siteDailySummary: { findMany: mocks.daily },
        siteWeeklyTrend: { upsert: mocks.upsert },
        $executeRaw: async () => {
          const previous = lockTail;
          lockTail = new Promise<void>((resolve) => {
            unlock = resolve;
          });

          // После патча B достигает ожидания блокировки.
          if (++lockCalls === 2) secondReached.resolve();

          await previous;
          return 1;
        },
      };

      try {
        return await work(tx);
      } finally {
        unlock?.();
      }
    },
  );

  const a = projectWeeklyTrend('site-1', '2026-10-19', 'tenant-1');
  await firstRead.promise;

  sourcePiles = 20;
  const b = projectWeeklyTrend('site-1', '2026-10-19', 'tenant-1');

  await secondReached.promise;
  releaseFirstRead.resolve();
  await Promise.all([a, b]);

  expect(storedPiles).toBe(20);
});
