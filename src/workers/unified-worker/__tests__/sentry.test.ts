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
  forEachTenant: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({
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

const ENV_KEYS = [
  'SENTRY_DSN',
  'PM_SCHEDULER_STARTUP_DELAY_MS',
  'PM_SCHEDULER_INTERVAL_MS',
  'READINESS_SCHEDULER_STARTUP_DELAY_MS',
  'READINESS_SCHEDULER_INTERVAL_MS',
] as const;

describe('Sentry в процессе воркера', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    for (const key of ENV_KEYS) delete process.env[key];
    // Один тенант в прогоне — планировщики идут через forEachTenant.
    mocks.forEachTenant.mockImplementation(async (run: (tenantId: string) => Promise<unknown>) => [
      await run('tenant-1'),
    ]);
  });

  afterEach(() => {
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
    process.env.PM_SCHEDULER_STARTUP_DELAY_MS = '0';
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
    process.env.READINESS_SCHEDULER_STARTUP_DELAY_MS = '0';
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
});
