import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
  outboxStats: vi.fn().mockResolvedValue({ unpublished: 0, failed: 0, total: 0 }),
  dlqStats: vi.fn().mockResolvedValue({ pending: 0 }),
  lagMetrics: vi.fn().mockReturnValue(null),
  startLagMonitor: vi.fn(),
  redisPing: vi.fn().mockResolvedValue('PONG'),
  statePing: vi.fn().mockResolvedValue('PONG'),
  redisGet: vi.fn(),
  redisSmembers: vi.fn().mockResolvedValue(['outbox']),
  stateGet: vi.fn(),
  stateSmembers: vi.fn().mockResolvedValue(['outbox']),
  readdir: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    $queryRaw: mocks.queryRaw,
  },
  getDatabaseProvider: vi.fn(() => 'postgresql'),
}));

/*
  Два инстанса, а не один: кэш (allkeys-lru) и состояние (noeviction). Пульс
  служб живёт на втором — см. getStateRedisClient. Разные шпионы здесь нужны
  именно затем, чтобы промах мимо инстанса было видно тестом, а не только на
  проде: там ws писал пульс в состояние, а app искал его в кэше.
*/
vi.mock('@/lib/redis-cache', () => ({
  getRedisClient: vi.fn(async () => ({
    ping: mocks.redisPing,
    get: mocks.redisGet,
    smembers: mocks.redisSmembers,
  })),
  getStateRedisClient: vi.fn(async () => ({
    ping: mocks.statePing,
    get: mocks.stateGet,
    smembers: mocks.stateSmembers,
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
    mocks.stateSmembers.mockResolvedValue(['outbox']);
    // Кэш пульса не знает — он лежит в инстансе состояния.
    mocks.redisGet.mockResolvedValue(null);
    mocks.stateGet.mockImplementation(async (key: string) => {
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

/*
  Инстанс, из которого читается пульс служб.

  На проде 22.09.2026 `/api/health/deep` отдавал 503 при живых службах. Причина
  — два Redis: ws и workers запущены без REDIS_URL_CACHE и писали пульс в
  инстанс состояния, а app с этой переменной искал его в кэше. Одинаковый код,
  разные адреса. Контейнер ws удалён 26.09.2026; урок проверяется на пульсе
  workers — его читает тот же код.

  Проверяем обе стороны промаха: пульс в состоянии — служба жива; тот же пульс
  в кэше — служба мертва. Второй случай и был продом.
*/
describe('пульс служб: инстанс состояния, а не кэш', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    mocks.outboxStats.mockResolvedValue({ unpublished: 0, failed: 0, total: 0 });
    mocks.dlqStats.mockResolvedValue({ pending: 0 });
    mocks.lagMetrics.mockReturnValue(null);
    mocks.redisPing.mockResolvedValue('PONG');
    mocks.statePing.mockResolvedValue('PONG');
    mocks.readdir.mockRejectedValue(new Error('missing backup directory'));
    delete process.env.BACKUP_ENABLED;
  });

  it('читает пульс служб из инстанса состояния', async () => {
    mocks.redisGet.mockResolvedValue(null);
    mocks.stateSmembers.mockResolvedValue(['outbox']);
    mocks.stateGet.mockImplementation(async (key: string) =>
      key === 'system:worker:heartbeat:outbox' ? String(Date.now()) : null);

    const { checkSystemStatus } = await import('../health-tracker');
    const status = await checkSystemStatus();

    expect(mocks.stateGet).toHaveBeenCalledWith('system:worker:heartbeat:outbox');
    expect(status.components.workers.status).toBe('running');
  });

  it('пульс, попавший в кэш вместо состояния, службу не воскрешает', async () => {
    // Ровно продовая картина: ключ есть, но не в том инстансе.
    mocks.redisGet.mockImplementation(async (key: string) =>
      key === 'system:worker:heartbeat:outbox' ? String(Date.now()) : null);
    mocks.stateSmembers.mockResolvedValue(['outbox']);
    mocks.stateGet.mockResolvedValue(null);

    const { checkSystemStatus } = await import('../health-tracker');
    const status = await checkSystemStatus();

    expect(status.components.workers.status).toBe('stopped');
    expect(status.status).toBe('unhealthy');
  });
});


describe('shouldLogHealthSnapshot', () => {
  it('пишет первую поломку — предыдущей картины ещё нет', async () => {
    const { shouldLogHealthSnapshot } = await import('../health-tracker/tracker');

    expect(shouldLogHealthSnapshot('unhealthy|up|down', null, 0)).toBe(true);
  });

  it('молчит, пока картина не изменилась и час не прошёл', async () => {
    const { shouldLogHealthSnapshot, HEALTH_LOG_REMINDER_MS } = await import(
      '../health-tracker/tracker'
    );

    const same = 'unhealthy|up|down';
    expect(shouldLogHealthSnapshot(same, same, 15_000)).toBe(false);
    expect(shouldLogHealthSnapshot(same, same, HEALTH_LOG_REMINDER_MS - 1)).toBe(false);
  });

  it('напоминает о неизменившейся поломке раз в час', async () => {
    const { shouldLogHealthSnapshot, HEALTH_LOG_REMINDER_MS } = await import(
      '../health-tracker/tracker'
    );

    const same = 'unhealthy|up|down';
    expect(shouldLogHealthSnapshot(same, same, HEALTH_LOG_REMINDER_MS)).toBe(true);
  });

  it('пишет смену картины немедленно, не дожидаясь часа', async () => {
    const { shouldLogHealthSnapshot } = await import('../health-tracker/tracker');

    expect(shouldLogHealthSnapshot('unhealthy|up|down', 'unhealthy|down|down', 1_000)).toBe(true);
  });
});
