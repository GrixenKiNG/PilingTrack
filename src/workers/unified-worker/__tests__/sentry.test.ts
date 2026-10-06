/**
 * Sentry в процессе воркера (F-WORKERS-SENTRY).
 *
 * Проверяет два обещания фикса:
 *  - без SENTRY_DSN инициализация не выполняется (SDK остаётся no-op);
 *  - падение планировщика, которое раньше уходило только в logger.error,
 *    теперь репортится в Sentry с тегом имени задачи.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sentryInit: vi.fn(),
  captureException: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  runPmScheduler: vi.fn(),
  runReadinessScheduler: vi.fn(),
  rebuildAll: vi.fn(),
  forEachTenant: vi.fn(),
  recordSchedulerHeartbeat: vi.fn(),
}));

vi.mock('@sentry/node', () => ({
  init: mocks.sentryInit,
  captureException: mocks.captureException,
}));

vi.mock('@/lib/logger', () => ({
  logger: mocks.logger,
}));

vi.mock('@/lib/tenant-iteration', () => ({
  forEachTenant: mocks.forEachTenant,
}));

vi.mock('@/lib/db', () => ({
  db: {
    tenant: { findMany: vi.fn() },
    equipment: { findMany: vi.fn() },
  },
}));

vi.mock('@/modules/equipment', () => ({
  runPmScheduler: mocks.runPmScheduler,
}));

vi.mock('@/modules/readiness/application/scheduler', () => ({
  runReadinessScheduler: mocks.runReadinessScheduler,
}));

vi.mock('@/modules/reports/application/projections/rebuild', () => ({
  rebuildAll: mocks.rebuildAll,
}));

vi.mock('@/workers/unified-worker/scheduler-heartbeat', () => ({
  recordSchedulerHeartbeat: mocks.recordSchedulerHeartbeat,
}));

const ENV_KEYS = [
  'SENTRY_DSN',
  'PM_SCHEDULER_STARTUP_DELAY_MS',
  'PM_SCHEDULER_INTERVAL_MS',
  'READINESS_SCHEDULER_STARTUP_DELAY_MS',
  'READINESS_SCHEDULER_INTERVAL_MS',
  'PROJECTION_REBUILD_STARTUP_DELAY_MS',
  'PROJECTION_REBUILD_INTERVAL_MS',
] as const;

describe('Sentry в процессе воркера', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.runPmScheduler.mockResolvedValue({ created: 0, due: 0, overdue: [] });
    mocks.runReadinessScheduler.mockResolvedValue({ permitsExpired: 0, shiftsAutoClosed: 0 });
    mocks.rebuildAll.mockResolvedValue([]);
    mocks.recordSchedulerHeartbeat.mockResolvedValue(undefined);
    for (const key of ENV_KEYS) delete process.env[key];
    // Один тенант в прогоне — планировщики идут через forEachTenant.
    mocks.forEachTenant.mockImplementation(async (run: (tenantId: string) => Promise<unknown>) => [
      await run('tenant-1'),
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it('без SENTRY_DSN не инициализирует Sentry', async () => {
    const { initWorkerSentry } = await import('@/workers/unified-worker/sentry');

    await initWorkerSentry();

    expect(mocks.sentryInit).not.toHaveBeenCalled();
  });

  it('с SENTRY_DSN подключает общий модуль инициализации', async () => {
    process.env.SENTRY_DSN = 'https://public@example.ingest.sentry.io/1';
    const { initWorkerSentry } = await import('@/workers/unified-worker/sentry');

    await initWorkerSentry();

    expect(mocks.sentryInit).toHaveBeenCalledTimes(1);
  });

  it('падение планировщика ТО уходит в Sentry с тегом задачи', async () => {
    // Задержка старта 1 мс = «прогон сразу»: 0 отвергается как неположительная
    // (positiveIntEnv, F-WORKER-ENV-INTS) и дала бы штатные 60 с.
    process.env.PM_SCHEDULER_STARTUP_DELAY_MS = '1';
    process.env.PM_SCHEDULER_INTERVAL_MS = '60000';
    mocks.runPmScheduler.mockRejectedValue(new Error('pm boom'));

    const { startPmScheduler } = await import('@/workers/unified-worker/pm-scheduler');
    const stop = startPmScheduler();

    try {
      await vi.waitFor(() => {
        expect(mocks.captureException).toHaveBeenCalled();
      });
    } finally {
      stop();
    }

    expect(mocks.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { task: 'pm-scheduler' },
    });
    expect(mocks.logger.error).toHaveBeenCalledWith('PM scheduler pass failed', expect.anything());
  });

  it('падение планировщика техготовности уходит в Sentry с тегом задачи', async () => {
    process.env.READINESS_SCHEDULER_STARTUP_DELAY_MS = '1';
    process.env.READINESS_SCHEDULER_INTERVAL_MS = '60000';
    mocks.runReadinessScheduler.mockRejectedValue(new Error('readiness boom'));

    const { startReadinessScheduler } = await import('@/workers/unified-worker/readiness-scheduler');
    const stop = startReadinessScheduler();

    try {
      await vi.waitFor(() => {
        expect(mocks.captureException).toHaveBeenCalled();
      });
    } finally {
      stop();
    }

    expect(mocks.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { task: 'readiness-scheduler' },
    });
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Readiness scheduler pass failed',
      expect.anything(),
    );
  });

  describe('пульс планировщика (F-SCHEDULER-HEARTBEAT)', () => {
    it('успешный проход планировщика ТО пишет пульс с именем и интервалом', async () => {
      process.env.PM_SCHEDULER_STARTUP_DELAY_MS = '1';
      process.env.PM_SCHEDULER_INTERVAL_MS = '60000';
      mocks.runPmScheduler.mockResolvedValue({ created: 0, due: 0, overdue: [] });

      const { startPmScheduler } = await import('@/workers/unified-worker/pm-scheduler');
      const stop = startPmScheduler();

      try {
        await vi.waitFor(() => {
          expect(mocks.recordSchedulerHeartbeat).toHaveBeenCalled();
        });
      } finally {
        stop();
      }

      expect(mocks.recordSchedulerHeartbeat).toHaveBeenCalledWith('pm-scheduler', 60000);
    });

    it('упавший проход пульса не пишет', async () => {
      process.env.PM_SCHEDULER_STARTUP_DELAY_MS = '1';
      process.env.PM_SCHEDULER_INTERVAL_MS = '60000';
      mocks.runPmScheduler.mockRejectedValue(new Error('pm boom'));

      const { startPmScheduler } = await import('@/workers/unified-worker/pm-scheduler');
      const stop = startPmScheduler();

      try {
        await vi.waitFor(() => {
          expect(mocks.logger.error).toHaveBeenCalledWith(
            'PM scheduler pass failed',
            expect.anything(),
          );
        });
      } finally {
        stop();
      }

      expect(mocks.recordSchedulerHeartbeat).not.toHaveBeenCalled();
    });
  });

  const schedulers = [
    {
      name: 'pm',
      prefix: 'PM_SCHEDULER',
      run: mocks.runPmScheduler,
      result: { created: 0, due: 0, overdue: [] },
      start: async () => (await import('../pm-scheduler')).startPmScheduler(),
    },
    {
      name: 'readiness',
      prefix: 'READINESS_SCHEDULER',
      run: mocks.runReadinessScheduler,
      result: { permitsExpired: 0, shiftsAutoClosed: 0 },
      start: async () => (await import('../readiness-scheduler')).startReadinessScheduler(),
    },
    {
      name: 'projection-rebuild',
      prefix: 'PROJECTION_REBUILD',
      run: mocks.rebuildAll,
      result: [],
      start: async () => (await import('../projection-rebuild-scheduler')).startProjectionRebuildScheduler(),
    },
  ];

  it.each(schedulers)('$name skips ticks until the active pass completes', async (scheduler) => {
    vi.useFakeTimers();
    process.env[scheduler.prefix + '_STARTUP_DELAY_MS'] = '1';
    process.env[scheduler.prefix + '_INTERVAL_MS'] = '100';
    let complete!: (value: unknown) => void;
    scheduler.run.mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
    const stop = await scheduler.start();
    try {
      await vi.advanceTimersByTimeAsync(1);
      expect(scheduler.run).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(299);
      expect(scheduler.run).toHaveBeenCalledTimes(1);
      complete(scheduler.result);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(100);
      expect(scheduler.run).toHaveBeenCalledTimes(2);
    } finally {
      stop();
    }
  });

  it.each(schedulers)('$name releases the guard after a failed pass', async (scheduler) => {
    vi.useFakeTimers();
    process.env[scheduler.prefix + '_STARTUP_DELAY_MS'] = '1';
    process.env[scheduler.prefix + '_INTERVAL_MS'] = '100';
    let fail!: (reason: Error) => void;
    scheduler.run.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
    const stop = await scheduler.start();
    try {
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(299);
      expect(scheduler.run).toHaveBeenCalledTimes(1);
      fail(new Error('blocked pass failed'));
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.captureException).toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(100);
      expect(scheduler.run).toHaveBeenCalledTimes(2);
    } finally {
      stop();
    }
  });

  it.each(schedulers)('$name holds the guard through heartbeat and releases it on failure', async (scheduler) => {
    vi.useFakeTimers();
    process.env[scheduler.prefix + '_STARTUP_DELAY_MS'] = '1';
    process.env[scheduler.prefix + '_INTERVAL_MS'] = '100';
    let fail!: (reason: Error) => void;
    mocks.recordSchedulerHeartbeat.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
    const stop = await scheduler.start();
    try {
      await vi.advanceTimersByTimeAsync(1);
      expect(mocks.recordSchedulerHeartbeat).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(299);
      expect(scheduler.run).toHaveBeenCalledTimes(1);
      fail(new Error('heartbeat unavailable'));
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.captureException).toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(100);
      expect(scheduler.run).toHaveBeenCalledTimes(2);
    } finally {
      stop();
    }
  });
});
