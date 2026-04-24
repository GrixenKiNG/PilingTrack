import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
  outboxStats: vi.fn().mockResolvedValue({ unpublished: 0, failed: 0, total: 0 }),
  dlqStats: vi.fn().mockResolvedValue({ pending: 0 }),
  lagMetrics: vi.fn().mockReturnValue(null),
  startLagMonitor: vi.fn(),
  redisPing: vi.fn().mockResolvedValue('PONG'),
  redisGet: vi.fn(),
  redisSmembers: vi.fn().mockResolvedValue(['outbox']),
  readdir: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    $queryRaw: mocks.queryRaw,
  },
  getDatabaseProvider: vi.fn(() => 'postgresql'),
}));

vi.mock('@/lib/redis-cache', () => ({
  getRedisClient: vi.fn(async () => ({
    ping: mocks.redisPing,
    get: mocks.redisGet,
    smembers: mocks.redisSmembers,
  })),
}));

vi.mock('@/services/reports/outbox-publisher', () => ({
  getOutboxStats: mocks.outboxStats,
}));

vi.mock('@/core/outbox/dead-letter-queue', () => ({
  getDlqStats: mocks.dlqStats,
}));

vi.mock('../lag-monitor', () => ({
  getLagMetrics: mocks.lagMetrics,
  startLagMonitor: mocks.startLagMonitor,
}));

vi.mock('fs', () => ({
  default: {
    promises: {
      readdir: mocks.readdir,
      stat: mocks.stat,
    },
  },
  promises: {
    readdir: mocks.readdir,
    stat: mocks.stat,
  },
}));

describe('health-tracker backup monitoring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    mocks.outboxStats.mockResolvedValue({ unpublished: 0, failed: 0, total: 0 });
    mocks.dlqStats.mockResolvedValue({ pending: 0 });
    mocks.lagMetrics.mockReturnValue(null);
    mocks.redisPing.mockResolvedValue('PONG');
    mocks.redisSmembers.mockResolvedValue(['outbox']);
    mocks.redisGet.mockImplementation(async (key: string) => {
      if (key === 'system:worker:heartbeat:outbox') {
        return String(Date.now());
      }

      if (key === 'system:ws:connections') {
        return '0';
      }

      return null;
    });
    mocks.readdir.mockRejectedValue(new Error('missing backup directory'));
    mocks.stat.mockReset();
    delete process.env.BACKUP_ENABLED;
    delete process.env.BACKUP_DIR;
  });

  it('skips backup failures when backup monitoring is disabled', async () => {
    const { checkSystemStatus } = await import('../health-tracker');

    const status = await checkSystemStatus();

    expect(status.components.backup.status).toBe('up');
    expect(status.components.backup.source).toBe('disabled');
    expect(status.status).toBe('healthy');
  });

  it('uses filesystem backup metadata as fallback', async () => {
    process.env.BACKUP_ENABLED = 'true';
    process.env.BACKUP_DIR = '/backups/pilingtrack';
    mocks.readdir.mockResolvedValue(['pilingtrack_20260422.dump']);
    mocks.stat.mockResolvedValue({
      mtime: new Date(Date.now() - 2 * 60 * 60 * 1000),
      size: 10 * 1024 * 1024,
    });

    const { checkSystemStatus } = await import('../health-tracker');

    const status = await checkSystemStatus();

    expect(status.components.backup.status).toBe('up');
    expect(status.components.backup.source).toBe('filesystem');
    expect(status.components.backup.lastBackupSize).toBe('10.00 MB');
    expect(status.status).toBe('healthy');
  });

  it('marks backup as degraded when monitoring is enabled but metadata is not available yet', async () => {
    process.env.BACKUP_ENABLED = 'true';

    const { checkSystemStatus } = await import('../health-tracker');

    const status = await checkSystemStatus();

    expect(status.components.backup.status).toBe('slow');
    expect(status.components.backup.source).toBe('missing');
    expect(status.status).toBe('degraded');
  });
});
