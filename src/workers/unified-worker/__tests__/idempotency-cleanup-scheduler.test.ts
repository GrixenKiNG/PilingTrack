/**
 * Уборка просроченных ключей идемпотентности (F-IDEMP-CLEANUP).
 *
 * Проверяет обещания фикса:
 *  - суточный проход планировщика вызывает cleanupExpiredKeys();
 *  - падение очистки не роняет воркер, а уходит в logger.error и Sentry;
 *  - пульс system:scheduler:idempotency-cleanup пишется только после
 *    успешного прохода.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  cleanupExpiredKeys: vi.fn(),
  recordSchedulerHeartbeat: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: mocks.captureException,
}));

vi.mock('@/lib/logger', () => ({
  logger: mocks.logger,
}));

vi.mock('@/core/security/idempotency', () => ({
  cleanupExpiredKeys: mocks.cleanupExpiredKeys,
}));

vi.mock('@/workers/unified-worker/scheduler-heartbeat', () => ({
  recordSchedulerHeartbeat: mocks.recordSchedulerHeartbeat,
}));

const ENV_KEYS = [
  'IDEMPOTENCY_CLEANUP_STARTUP_DELAY_MS',
  'IDEMPOTENCY_CLEANUP_INTERVAL_MS',
] as const;

async function startWithCleanup(): Promise<{
  startIdempotencyCleanupScheduler: () => () => void;
}> {
  process.env.IDEMPOTENCY_CLEANUP_STARTUP_DELAY_MS = '0';
  process.env.IDEMPOTENCY_CLEANUP_INTERVAL_MS = '60000';
  return import('@/workers/unified-worker/idempotency-cleanup-scheduler');
}

describe('уборка ключей идемпотентности (F-IDEMP-CLEANUP)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it('проход вызывает cleanupExpiredKeys и пишет пульс', async () => {
    mocks.cleanupExpiredKeys.mockResolvedValue(3);

    const { startIdempotencyCleanupScheduler } = await startWithCleanup();
    const stop = startIdempotencyCleanupScheduler();

    try {
      await vi.waitFor(() => {
        expect(mocks.recordSchedulerHeartbeat).toHaveBeenCalled();
      });
    } finally {
      stop();
    }

    expect(mocks.cleanupExpiredKeys).toHaveBeenCalledTimes(1);
    expect(mocks.recordSchedulerHeartbeat).toHaveBeenCalledWith('idempotency-cleanup', 60000);
  });

  it('падение очистки не роняет воркер: logger.error и Sentry, пульса нет', async () => {
    mocks.cleanupExpiredKeys.mockRejectedValue(new Error('cleanup boom'));

    const { startIdempotencyCleanupScheduler } = await startWithCleanup();
    const stop = startIdempotencyCleanupScheduler();

    try {
      await vi.waitFor(() => {
        expect(mocks.logger.error).toHaveBeenCalled();
      });
    } finally {
      stop();
    }

    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Idempotency keys cleanup pass failed',
      expect.anything(),
    );
    expect(mocks.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { task: 'idempotency-cleanup' },
    });
    expect(mocks.recordSchedulerHeartbeat).not.toHaveBeenCalled();
  });

  it('функция остановки гасит таймеры', async () => {
    mocks.cleanupExpiredKeys.mockResolvedValue(0);

    const { startIdempotencyCleanupScheduler } = await startWithCleanup();
    const stop = startIdempotencyCleanupScheduler();
    stop();

    expect(mocks.cleanupExpiredKeys).not.toHaveBeenCalled();
  });
});
