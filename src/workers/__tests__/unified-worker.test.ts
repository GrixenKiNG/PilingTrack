/**
 * Unified Worker Service — Unit Tests
 *
 * Tests the unified worker service:
 * - Health check endpoint
 * - Worker lifecycle (start/stop)
 * - Error handling
 * - Graceful shutdown
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import http, { type IncomingMessage, type ServerResponse, type RequestListener } from 'http';

// ============================================================
// Mocks
// ============================================================

const mocks = vi.hoisted(() => ({
  // Outbox
  mockStartOutboxWorker: vi.fn(),
  mockGetOutboxStats: vi.fn().mockResolvedValue({ unpublished: 0, failed: 0, total: 0 }),
  mockEmitDomainEvent: vi.fn().mockResolvedValue(undefined),
  mockRegisterAllEventSchemas: vi.fn(),

  // Projection
  mockStartProjectionWorker: vi.fn(),

  // PDF
  mockBullMQWorker: vi.fn(),
  // Один и тот же объект воркера на все тесты: фабрика vi.mock('bullmq')
  // выполняется заново после каждого resetModules и перезаписала бы
  // возврат, заданный тестом.
  mockPdfWorker: {
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  },

  // Health
  mockRecordWorkerHeartbeat: vi.fn().mockResolvedValue(undefined),

  // Shutdown: соединения
  mockCloseRedisConnection: vi.fn().mockResolvedValue(undefined),
  mockDisconnect: vi.fn().mockResolvedValue(undefined),

  // Leader election
  mockOutboxElection: {
    onBecomeLeader: undefined as undefined | (() => void),
    onLoseLeadership: undefined as undefined | (() => void),
    start: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
    isLeader: vi.fn(() => true),
    getStats: vi.fn(() => ({ nodeId: 'test-node' })),
  },
  mockProjectionElection: {
    onBecomeLeader: undefined as undefined | (() => void),
    onLoseLeadership: undefined as undefined | (() => void),
    start: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
    isLeader: vi.fn(() => true),
    getStats: vi.fn(() => ({ nodeId: 'test-node' })),
  },

  // Logger
  mockLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },

  // HTTP server
  mockHttpListen: vi.fn(),
  // Останавливаемый сервер обязан вызвать колбэк close(): gracefulShutdown
  // ждёт его и без вызова завис бы до дедлайна.
  mockHttpClose: vi.fn((callback?: () => void) => {
    callback?.();
  }),
}));

mocks.mockOutboxElection.start.mockImplementation(async () => {
  mocks.mockOutboxElection.onBecomeLeader?.();
});

mocks.mockProjectionElection.start.mockImplementation(async () => {
  mocks.mockProjectionElection.onBecomeLeader?.();
});

vi.mock('@/services/reports/outbox-publisher', () => ({
  startOutboxWorker: mocks.mockStartOutboxWorker.mockReturnValue({
    stop: vi.fn(),
  }),
  getOutboxStats: mocks.mockGetOutboxStats,
}));

vi.mock('@/services/reports/domain-events', () => ({
  emitDomainEvent: mocks.mockEmitDomainEvent,
}));

vi.mock('@/core/event-bus/schema-registry', () => ({
  registerAllEventSchemas: mocks.mockRegisterAllEventSchemas,
}));

vi.mock('@/modules/reports/application/projections/projection-worker', () => ({
  startProjectionWorker: mocks.mockStartProjectionWorker.mockReturnValue({
    stop: vi.fn(),
  }),
}));

vi.mock('@/services/reports/event-handlers', () => ({
  registerAllEventHandlers: vi.fn(),
}));

vi.mock('@/core/observability/health-tracker', () => ({
  recordWorkerHeartbeat: mocks.mockRecordWorkerHeartbeat,
}));

vi.mock('@/core/infrastructure/leader-election', () => ({
  getOutboxLeaderElection: vi.fn(() => mocks.mockOutboxElection),
  getProjectionLeaderElection: vi.fn(() => mocks.mockProjectionElection),
}));

// Заменяем только закрытие соединений: остальные экспорты (getStateRedisClient,
// DEFAULT_TX_OPTIONS и т.п.) остаются настоящими — их дёргает граф воркеров.
vi.mock('@/lib/redis-cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/redis-cache')>()),
  closeRedisConnection: mocks.mockCloseRedisConnection,
}));

vi.mock('@/lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db')>()),
  db: { $disconnect: mocks.mockDisconnect },
}));

vi.mock('@/lib/logger', () => ({
  logger: mocks.mockLogger,
}));

vi.mock('bullmq', () => ({
  // Только класс: vitest запрещает mockReturnValue у функции, вызванной
  // через `new` (pdf.ts делает `new Worker(...)`).
  Worker: mocks.mockBullMQWorker.mockImplementation(
    class {
      on = mocks.mockPdfWorker.on;
      close = mocks.mockPdfWorker.close;
    } as unknown as (...args: unknown[]) => unknown,
  ),
}));

vi.mock('ioredis', () => ({
  default: class MockRedis {
    constructor() {}
    async quit() {}
  },
}));

vi.mock('http', () => ({
  default: {
    createServer: vi.fn().mockReturnValue({
      listen: mocks.mockHttpListen,
      close: mocks.mockHttpClose,
    }),
  },
}));

// ============================================================
// Tests
// ============================================================

// Каждому тесту нужен запас 30 с: после vi.resetModules() (см. beforeEach) каждый
// тест заново импортирует холодный граф воркера, поэтому таймаут вынесен на
// describe, а не на один тест (R70, находка 1).
describe('Unified Worker Service', { timeout: 30_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.mockOutboxElection.onBecomeLeader = undefined;
    mocks.mockOutboxElection.onLoseLeadership = undefined;
    mocks.mockProjectionElection.onBecomeLeader = undefined;
    mocks.mockProjectionElection.onLoseLeadership = undefined;

    // Set env vars for testing
    process.env.ENABLED_WORKERS = 'outbox,projection';
    process.env.WORKER_HEALTH_PORT = '3102'; // Порт проверяем явный: 0 помощник отвергает
    process.env.OUTBOX_INTERVAL_MS = '100';
    process.env.PROJECTION_INTERVAL_MS = '100';
  });

  afterEach(() => {
    delete process.env.ENABLED_WORKERS;
    delete process.env.WORKER_HEALTH_PORT;
    delete process.env.OUTBOX_INTERVAL_MS;
    delete process.env.PROJECTION_INTERVAL_MS;
    delete process.env.WORKER_SHUTDOWN_TIMEOUT_MS;
    delete process.env.REDIS_URL;
    // Opt-in (F-IDEMP-CLEANUP-OPTIN): переменную ставит только тест и только
    // на своё время — иначе она включила бы уборку соседям по файлу.
    delete process.env.IDEMPOTENCY_CLEANUP_ENABLED;
  });

  describe('Health check endpoint', () => {
    // 30s timeout, not the default 5s: this is the FIRST test in the file, so its
    // `import('@/workers/unified-worker')` is the one that pays Vite's transform
    // cost for the whole worker module graph (unified-worker/* → @/lib/db,
    // @/modules/equipment, @/modules/reports/.../rebuild, @/lib/pdf-generator —
    // only the leaf modules are mocked, the graph itself is still transformed).
    // The later tests re-import after vi.resetModules(); the transform cache is
    // warm by then, so they cost ~0 — but they carry the same 30s budget through
    // the describe-level timeout, since it is the same class of cost.
    //
    // That cost scales with how many vitest workers compete for the transform
    // pipeline — measured on a 16-core box: 1 worker 376ms, 8 → 608ms,
    // 16 → 1.4s, 32 → 3.4s, 48 → 8.4s. It degrades smoothly and always completes
    // (verified with a heartbeat probe: the event loop stays responsive the whole
    // time, it is queueing on transforms, not hanging), so this is a cost, not a
    // deadlock — do not "fix" it by chasing a bug in the worker module graph.
    //
    // Лимит стоит на тесте, а не на vi.waitFor ниже: дорогой здесь сам import,
    // и он выполняется ДО ожидания — таймаут внутри waitFor до него не дошёл бы.
    //
    // Here the cold-import cost is documented on this test (the explicit 30_000
    // duplicates the describe-level timeout); the timeout belongs to whichever
    // test imports the graph first, not to this test's assertions.
    it('returns health status with worker information', async () => {
      // Import to trigger server creation
      await import('@/workers/unified-worker');

      // Wait for initialization
      await vi.waitFor(() => {
        expect(mocks.mockHttpListen).toHaveBeenCalled();
      });

      // Health server should be created with correct port
      expect(mocks.mockHttpListen).toHaveBeenCalledWith(
        3102, // WORKER_HEALTH_PORT
        expect.any(Function)
      );
    }, 30_000);
  });

  describe('Метрики отдельных воркеров', () => {
    it('отличает включённый остановившийся worker от отключённого и standby', async () => {
      process.env.ENABLED_WORKERS = 'outbox,projection';
      const { workerStates } = await import('@/workers/unified-worker/state');
      const { startHealthServer } = await import('@/workers/unified-worker/health-server');
      workerStates.outbox.status = 'error';
      workerStates.projection.status = 'running';
      workerStates.projection.isLeader = false;
      workerStates.pdf.status = 'stopped';
      startHealthServer();

      const listener = vi.mocked(http.createServer).mock.calls.at(-1)?.[0] as unknown as RequestListener | undefined;
      if (typeof listener !== 'function') throw new Error('Обработчик health-сервера не установлен');
      const response = { writeHead: vi.fn(), end: vi.fn() };
      listener({ url: '/metrics' } as IncomingMessage, response as unknown as ServerResponse);
      const text = response.end.mock.calls[0][0];

      expect(text).toContain('worker_status{name="outbox"} 0\n');
      expect(text).toContain('worker_enabled{name="outbox"} 1\n');
      expect(text).toContain('worker_status{name="projection"} 1\n');
      expect(text).toContain('worker_enabled{name="projection"} 1\n');
      expect(text).toContain('worker_is_leader{name="projection"} 0\n');
      expect(text).toContain('worker_status{name="pdf"} 0\n');
      expect(text).toContain('worker_enabled{name="pdf"} 0\n');
    });
  });
  describe('Worker lifecycle', () => {
    it('starts outbox worker when enabled', async () => {
      process.env.ENABLED_WORKERS = 'outbox';

      await import('@/workers/unified-worker');

      await vi.waitFor(() => {
        expect(mocks.mockStartOutboxWorker).toHaveBeenCalled();
      });
    });

    it('starts projection worker when enabled', async () => {
      process.env.ENABLED_WORKERS = 'projection';

      await import('@/workers/unified-worker');

      await vi.waitFor(() => {
        expect(mocks.mockStartProjectionWorker).toHaveBeenCalled();
      });
    });

    it('does not start disabled workers', async () => {
      process.env.ENABLED_WORKERS = 'outbox';

      await import('@/workers/unified-worker');

      await vi.waitFor(() => {
        expect(mocks.mockStartOutboxWorker).toHaveBeenCalled();
        expect(mocks.mockStartProjectionWorker).not.toHaveBeenCalled();
      });
    });

    it('uses configured polling intervals', async () => {
      process.env.ENABLED_WORKERS = 'outbox';
      process.env.OUTBOX_INTERVAL_MS = '5000';

      await import('@/workers/unified-worker');

      await vi.waitFor(() => {
        expect(mocks.mockStartOutboxWorker).toHaveBeenCalledWith(
          expect.any(Function),
          5000
        );
      });
    });
  });

  describe('Error handling', () => {
    it('records heartbeat after successful event processing', async () => {
      process.env.ENABLED_WORKERS = 'outbox';

      // Get the handler passed to startOutboxWorker
      await import('@/workers/unified-worker');

      await vi.waitFor(() => {
        expect(mocks.mockStartOutboxWorker).toHaveBeenCalled();
      });

      const handler = mocks.mockStartOutboxWorker.mock.calls[0][0];

      // Simulate event processing
      await handler({
        type: 'report.created',
        aggregateId: 'r1',
        aggregateType: 'Report',
        occurredAt: new Date().toISOString(),
      });

      // Heartbeat should be recorded
      expect(mocks.mockEmitDomainEvent).toHaveBeenCalled();
    });
  });

  describe('Уборка ключей идемпотентности включается только явно (F-IDEMP-CLEANUP-OPTIN)', () => {
    /*
      Планировщик уборки не виден снаружи ничем, кроме своих таймеров: пульс он
      пишет только после прохода (а проход — раз в сутки). Поэтому считаем
      интервалы, созданные при старте воркера, и сравниваем два запуска одного и
      того же графа: лишний интервал — это и есть поднятый планировщик.
    */
    async function countIntervals(): Promise<number> {
      vi.clearAllTimers(); // таймеры прошлого запуска не должны попасть в счёт
      const intervalSpy = vi.spyOn(globalThis, 'setInterval');
      try {
        const listenersBefore = process.listeners('SIGTERM').length;
        await import('@/workers/unified-worker');
        await vi.waitFor(() => {
          expect(process.listeners('SIGTERM').length).toBeGreaterThan(listenersBefore);
        });
        return intervalSpy.mock.calls.length;
      } finally {
        intervalSpy.mockRestore();
      }
    }

    it("'true' включает уборку, а не заданная переменная, 'false' и '1' — нет", async () => {
      process.env.ENABLED_WORKERS = 'outbox';
      vi.useFakeTimers();

      try {
        delete process.env.IDEMPOTENCY_CLEANUP_ENABLED;
        const unset = await countIntervals();

        vi.resetModules();
        process.env.IDEMPOTENCY_CLEANUP_ENABLED = 'false';
        const explicitFalse = await countIntervals();

        vi.resetModules();
        process.env.IDEMPOTENCY_CLEANUP_ENABLED = '1';
        const one = await countIntervals();

        vi.resetModules();
        process.env.IDEMPOTENCY_CLEANUP_ENABLED = 'true';
        const enabled = await countIntervals();

        expect(explicitFalse).toBe(unset);
        expect(one).toBe(unset);
        expect(enabled).toBe(unset + 1);
      } finally {
        vi.useRealTimers();
        delete process.env.IDEMPOTENCY_CLEANUP_ENABLED;
      }
    });
  });

  describe('Graceful shutdown (F-SHUTDOWN-SIGNALS)', () => {
    it('по SIGTERM снимает таймеры планировщиков, закрывает очередь PDF, отпускает замок и соединения', async () => {
      process.env.ENABLED_WORKERS = 'outbox,projection,pdf';
      // Уборка ключей идемпотентности теперь opt-in (F-IDEMP-CLEANUP-OPTIN) —
      // включаем её явно, иначе четвёртого планировщика в арифметике ниже нет.
      process.env.IDEMPOTENCY_CLEANUP_ENABLED = 'true';
      vi.useFakeTimers();

      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

      try {
        const listenersBefore = process.listeners('SIGTERM').length;

        await import('@/workers/unified-worker');

        await vi.waitFor(() => {
          expect(process.listeners('SIGTERM').length).toBeGreaterThan(listenersBefore);
        });

        const clearTimeoutsBefore = clearTimeoutSpy.mock.calls.length;
        const clearIntervalsBefore = clearIntervalSpy.mock.calls.length;

        const listeners = process.listeners('SIGTERM');
        (listeners[listeners.length - 1] as () => void)();

        await vi.waitFor(
          () => {
            expect(exitSpy).toHaveBeenCalledWith(0);
          },
          { timeout: 5_000 },
        );

        // Замки лидера отпущены сразу, а не по истечении TTL: пересозданный
        // контейнер не должен ждать 30 с, пока старый отдаст лок.
        expect(mocks.mockOutboxElection.stop).toHaveBeenCalled();
        expect(mocks.mockProjectionElection.stop).toHaveBeenCalled();

        // Очередь BullMQ закрыта (worker.close), а не брошена на SIGKILL.
        expect(mocks.mockPdfWorker.close).toHaveBeenCalled();

        // Таймеры планировщиков сняты; считаем точные числа, чтобы потеря
        // любого из них роняла тест. Слагаемые:
        //   4 × (setTimeout старта)              = 4  + дедлайн остановки = 5;
        //   4 × (setInterval повтора)            = 4
        //   + outbox (пульс + статистика)        = 2
        //   + projection (пульс)                 = 1
        //   + pdf (пульс)                        = 1  → 8.
        expect(clearTimeoutSpy.mock.calls.length - clearTimeoutsBefore).toBe(5);
        expect(clearIntervalSpy.mock.calls.length - clearIntervalsBefore).toBe(8);

        // Соединения закрыты последними.
        expect(mocks.mockCloseRedisConnection).toHaveBeenCalled();
        expect(mocks.mockDisconnect).toHaveBeenCalled();
      } finally {
        exitSpy.mockRestore();
        clearTimeoutSpy.mockRestore();
        clearIntervalSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('не ждёт зависшую остановку дольше предела и выходит сама', async () => {
      process.env.ENABLED_WORKERS = 'pdf';
      process.env.WORKER_SHUTDOWN_TIMEOUT_MS = '500';
      vi.useFakeTimers();

      // Задача PDF «в работе»: close() не завершается никогда.
      mocks.mockPdfWorker.close.mockImplementationOnce(() => new Promise(() => {}));

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

      try {
        const listenersBefore = process.listeners('SIGTERM').length;

        await import('@/workers/unified-worker');

        await vi.waitFor(() => {
          expect(process.listeners('SIGTERM').length).toBeGreaterThan(listenersBefore);
        });

        const listeners = process.listeners('SIGTERM');
        (listeners[listeners.length - 1] as () => void)();

        await vi.waitFor(
          () => {
            expect(exitSpy).toHaveBeenCalledWith(1);
          },
          { timeout: 5_000 },
        );
      } finally {
        exitSpy.mockRestore();
        vi.useRealTimers();
      }
    });
  });
});
