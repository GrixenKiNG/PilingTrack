/*
  Поведение агрегата здоровья (aggregate.ts).

  Проверяем решение, а не вызовы: как сводятся статусы семи компонентов в один
  вердикт, что побеждает при смеси отказов и что подставляется вместо упавшего
  чекера. Чекеры — границы (БД, Redis, S3, бэкап) и замоканы целиком; логика
  самого aggregate.ts работает настоящая.

  Модуль отдаёт наружу только checkSystemStatus — его и вызываем.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkDatabase: vi.fn(),
  checkRedis: vi.fn(),
  checkOutbox: vi.fn(),
  checkWorkers: vi.fn(),
  checkSchedulers: vi.fn(),
  checkStorage: vi.fn(),
  getStorageProvider: vi.fn(),
  checkBackupStatus: vi.fn(),
  getLagMetrics: vi.fn(),
  getOutboxStats: vi.fn(),
  getDlqStats: vi.fn(),
}));

vi.mock('@/core/observability/health-tracker/checkers/database', () => ({
  checkDatabase: mocks.checkDatabase,
}));

vi.mock('@/core/observability/health-tracker/checkers/redis', () => ({
  checkRedis: mocks.checkRedis,
}));

vi.mock('@/core/observability/health-tracker/checkers/outbox', () => ({
  checkOutbox: mocks.checkOutbox,
}));

vi.mock('@/core/observability/health-tracker/checkers/workers', () => ({
  checkWorkers: mocks.checkWorkers,
}));

vi.mock('@/core/observability/health-tracker/checkers/schedulers', () => ({
  checkSchedulers: mocks.checkSchedulers,
}));

vi.mock('@/core/observability/health-tracker/checkers/storage', () => ({
  checkStorage: mocks.checkStorage,
  getStorageProvider: mocks.getStorageProvider,
}));

vi.mock('@/core/observability/health-tracker/checkers/backup', () => ({
  checkBackupStatus: mocks.checkBackupStatus,
}));

vi.mock('@/core/observability/lag-monitor', () => ({
  getLagMetrics: mocks.getLagMetrics,
}));

vi.mock('@/core/outbox/outbox-stats', () => ({
  getOutboxStats: mocks.getOutboxStats,
}));

vi.mock('@/core/outbox/dead-letter-queue', () => ({
  getDlqStats: mocks.getDlqStats,
}));

const HEARTBEAT = '2026-10-21T09:59:00.000Z';

describe('checkSystemStatus: агрегация статусов компонентов', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkDatabase.mockResolvedValue({ status: 'up', latencyMs: 1 });
    mocks.checkRedis.mockResolvedValue({ status: 'up', latencyMs: 1 });
    mocks.checkOutbox.mockResolvedValue({ status: 'ok', pendingCount: 0 });
    mocks.checkWorkers.mockResolvedValue({ status: 'running', lastHeartbeat: HEARTBEAT });
    mocks.checkSchedulers.mockResolvedValue({ status: 'ok', stale: [] });
    mocks.checkStorage.mockResolvedValue({ status: 'up', provider: 'local' });
    mocks.getStorageProvider.mockReturnValue('local');
    mocks.checkBackupStatus.mockResolvedValue({ status: 'up' });
    mocks.getLagMetrics.mockReturnValue(null);
    mocks.getOutboxStats.mockResolvedValue({ unpublished: 0, failed: 0, total: 0 });
    mocks.getDlqStats.mockResolvedValue({ pending: 0, resolved: 0, discarded: 0, total: 0 });
    vi.stubEnv('APP_VERSION', '9.9.9-test');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('все компоненты в норме → healthy, в снимке версия и время проверки', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-21T10:00:00.000Z') });
    const { checkSystemStatus } = await import('../aggregate');

    const status = await checkSystemStatus();

    expect(status.status).toBe('healthy');
    expect(status.components).toEqual({
      database: { status: 'up', latencyMs: 1 },
      redis: { status: 'up', latencyMs: 1 },
      outbox: { status: 'ok', pendingCount: 0 },
      workers: { status: 'running', lastHeartbeat: HEARTBEAT },
      schedulers: { status: 'ok', stale: [] },
      storage: { status: 'up', provider: 'local' },
      backup: { status: 'up' },
    });
    expect(status.version).toBe('9.9.9-test');
    expect(status.timestamp).toBe('2026-10-21T10:00:00.000Z');
    expect(status.metrics.uptime).toBeGreaterThanOrEqual(0);
  });

  it('упавшая база перевешивает шесть живых компонентов → unhealthy', async () => {
    mocks.checkDatabase.mockResolvedValue({ status: 'down', latencyMs: 2000 });
    const { checkSystemStatus } = await import('../aggregate');

    const status = await checkSystemStatus();

    expect(status.components.database.status).toBe('down');
    expect(status.components.redis.status).toBe('up');
    expect(status.components.storage.status).toBe('up');
    expect(status.status).toBe('unhealthy');
  });

  it('backlog в outbox — это degraded, но не unhealthy', async () => {
    mocks.checkOutbox.mockResolvedValue({ status: 'backlog', pendingCount: 501 });
    const { checkSystemStatus } = await import('../aggregate');

    const status = await checkSystemStatus();

    expect(status.components.outbox).toEqual({ status: 'backlog', pendingCount: 501 });
    expect(status.status).toBe('degraded');
  });

  it('истёкший пульс планировщика даёт degraded, а не unhealthy (R59 #2)', async () => {
    // Остановившаяся суточная рутина — тихая потеря, но приложение работает:
    // иначе /api/health/deep отдавал бы 503 и будил мониторинг напрасно.
    mocks.checkSchedulers.mockResolvedValue({ status: 'stale', stale: ['pm-scheduler'] });
    const { checkSystemStatus } = await import('../aggregate');

    const status = await checkSystemStatus();

    expect(status.components.schedulers).toEqual({ status: 'stale', stale: ['pm-scheduler'] });
    expect(status.status).toBe('degraded');
  });

  it('при смеси «slow» и «down» побеждает худший статус → unhealthy', async () => {
    mocks.checkRedis.mockResolvedValue({ status: 'slow', latencyMs: 500 });
    mocks.checkWorkers.mockResolvedValue({ status: 'stopped' });
    const { checkSystemStatus } = await import('../aggregate');

    const status = await checkSystemStatus();

    expect(status.components.redis.status).toBe('slow');
    expect(status.components.workers.status).toBe('stopped');
    expect(status.status).toBe('unhealthy');
  });

  it('упавший чекер не роняет проверку: подставляется отказ и вердикт unhealthy', async () => {
    mocks.checkDatabase.mockRejectedValue(new Error('db gone'));
    mocks.checkOutbox.mockRejectedValue(new Error('outbox gone'));
    mocks.checkSchedulers.mockRejectedValue(new Error('schedulers gone'));
    mocks.checkStorage.mockRejectedValue(new Error('storage gone'));
    mocks.getStorageProvider.mockReturnValue('s3');
    const { checkSystemStatus } = await import('../aggregate');

    const status = await checkSystemStatus();

    expect(status.components.database).toEqual({ status: 'down' });
    // -1 — «не смогли посчитать»: ноль читался бы как пустая очередь.
    expect(status.components.outbox).toEqual({ status: 'stalled', pendingCount: -1 });
    expect(status.components.schedulers).toEqual({ status: 'stale', stale: [] });
    expect(status.components.storage).toEqual({ status: 'down', provider: 's3' });
    expect(status.status).toBe('unhealthy');
  });

  it('метрики очередей берутся из lag-монитора, когда он уже собрал снимок', async () => {
    mocks.getLagMetrics.mockReturnValue({ outboxPendingCount: 11, dlqPendingCount: 3 });
    // Значения из БД намеренно другие: если агрегат сходит в них, тест это увидит.
    mocks.getOutboxStats.mockResolvedValue({ unpublished: 100, failed: 0, total: 100 });
    mocks.getDlqStats.mockResolvedValue({ pending: 50, resolved: 0, discarded: 0, total: 50 });
    const { checkSystemStatus } = await import('../aggregate');

    const status = await checkSystemStatus();

    expect(status.metrics.outboxPending).toBe(11);
    expect(status.metrics.dlqPending).toBe(3);
  });

  it('без lag-монитора метрики best-effort: упавший источник даёт 0, а не отказ проверки', async () => {
    mocks.getLagMetrics.mockReturnValue(null);
    mocks.getOutboxStats.mockRejectedValue(new Error('outbox stats failed'));
    mocks.getDlqStats.mockResolvedValue({ pending: 4, resolved: 0, discarded: 0, total: 4 });
    const { checkSystemStatus } = await import('../aggregate');

    const status = await checkSystemStatus();

    expect(status.metrics.outboxPending).toBe(0);
    expect(status.metrics.dlqPending).toBe(4);
    expect(status.status).toBe('healthy');
  });
});
