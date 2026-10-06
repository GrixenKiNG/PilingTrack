import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_CHECK_TIMEOUT_MS } from '../health-tracker/thresholds';

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
  // Инстанс состояния может быть недоступен: проверка обязана выжить.
  stateClient: { available: true },
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
  getStateRedisClient: vi.fn(async () =>
    mocks.stateClient.available
      ? {
          ping: mocks.statePing,
          get: mocks.stateGet,
          smembers: mocks.stateSmembers,
        }
      : null),
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

const s3Mock = vi.hoisted(() => ({ getS3ClientForHealth: vi.fn() }));

vi.mock('../s3-health-check', () => ({
  getS3ClientForHealth: s3Mock.getS3ClientForHealth,
}));

/*
  Свежий пульс всех планировщиков (F-HEALTH-SCHEDULERS).

  Планировщики пишут `system:scheduler:<имя>` с TTL в три интервала. Тесты про
  бэкап, хранилище и пульс служб к планировщикам отношения не имеют — без этой
  подстановки они бы получали 'degraded' из-за отсутствующих ключей и падали бы
  не по своей причине.
*/
function freshSchedulerHeartbeat(key: string): string | null {
  return key.startsWith('system:scheduler:') ? new Date().toISOString() : null;
}

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

      return freshSchedulerHeartbeat(key);
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


/*
  Ключи бэкапа: инстанс состояния, а не кэш (F-OFFSITE-SIGNAL-b).

  scripts/backup-postgres.sh пишет system:backup:* в инстанс состояния
  (REDIS_URL). На проде задан REDIS_URL_CACHE, и getRedisClient уходит на
  вытесняющий кэш — ключей там нет, метрики бэкапа оставались нулями (та же
  ловушка двух Redis, что и с пульсом служб). Проверка должна брать
  getStateRedisClient: state-клиент вызван, кэш ключей бэкапа не видит.
*/
describe('ключи бэкапа: инстанс состояния, а не кэш (F-OFFSITE-SIGNAL-b)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    mocks.outboxStats.mockResolvedValue({ unpublished: 0, failed: 0, total: 0 });
    mocks.dlqStats.mockResolvedValue({ pending: 0 });
    mocks.lagMetrics.mockReturnValue(null);
    mocks.redisPing.mockResolvedValue('PONG');
    mocks.statePing.mockResolvedValue('PONG');
    mocks.redisSmembers.mockResolvedValue(['outbox']);
    mocks.stateSmembers.mockResolvedValue(['outbox']);
    mocks.readdir.mockRejectedValue(new Error('missing backup directory'));
    process.env.BACKUP_ENABLED = 'true';
    // Продовая конфигурация app-контейнера: кэш-инстанс задан.
    process.env.REDIS_URL_CACHE = 'redis://redis-cache:6379';
  });

  afterEach(() => {
    delete process.env.BACKUP_ENABLED;
    delete process.env.REDIS_URL_CACHE;
  });

  it('читает system:backup:* из инстанса состояния', async () => {
    mocks.redisGet.mockResolvedValue(null);
    mocks.stateGet.mockImplementation(async (key: string) => {
      if (key === 'system:backup:last_timestamp') {
        return new Date(Date.now() - 60 * 60 * 1000).toISOString();
      }
      if (key === 'system:backup:last_size') {
        return '10485760';
      }
      if (key === 'system:backup:s3_synced') {
        return 'true';
      }
      return null;
    });

    const { checkSystemStatus } = await import('../health-tracker');
    const status = await checkSystemStatus();

    expect(mocks.stateGet).toHaveBeenCalledWith('system:backup:last_timestamp');
    expect(status.components.backup.source).toBe('redis');
    expect(status.components.backup.status).toBe('up');
    expect(status.components.backup.s3Synced).toBe(true);
    // Кэш ключей бэкапа не получал — на проде их там и нет.
    expect(mocks.redisGet).not.toHaveBeenCalledWith('system:backup:last_timestamp');
  });

  it('ключи бэкапа, попавшие в кэш вместо состояния, метрику не воскрешают', async () => {
    mocks.redisGet.mockImplementation(async (key: string) =>
      key.startsWith('system:backup:') ? new Date().toISOString() : null);
    mocks.stateGet.mockResolvedValue(null);

    const { checkSystemStatus } = await import('../health-tracker');
    const status = await checkSystemStatus();

    expect(status.components.backup.source).toBe('missing');
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

/*
  Медленный R2 ≠ упавший R2 (F-R50-1).

  Прежде health-чек S3 использовал таймаут БД (2 с) и любой ответ дольше давал
  storage:'down' → система 'unhealthy' (16 ложных «морганий» в сутки на бою).
  Теперь у хранилища свой порог (STORAGE_CHECK_TIMEOUT_MS), таймаут отдаёт
  'degraded', а 'down' остаётся только за явной ошибкой.
*/
describe('storage health: медленный S3 ≠ упавший S3 (F-R50-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    mocks.outboxStats.mockResolvedValue({ unpublished: 0, failed: 0, total: 0 });
    mocks.dlqStats.mockResolvedValue({ pending: 0 });
    mocks.lagMetrics.mockReturnValue(null);
    mocks.redisPing.mockResolvedValue('PONG');
    mocks.statePing.mockResolvedValue('PONG');
    mocks.redisSmembers.mockResolvedValue(['outbox']);
    mocks.stateSmembers.mockResolvedValue(['outbox']);
    mocks.redisGet.mockResolvedValue(null);
    mocks.stateGet.mockImplementation(async (key: string) =>
      key === 'system:worker:heartbeat:outbox' ? String(Date.now()) : null);
    mocks.readdir.mockRejectedValue(new Error('missing backup directory'));
    delete process.env.BACKUP_ENABLED;
    process.env.S3_BUCKET = 'test-bucket';
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.S3_BUCKET;
  });

  it('медленный S3 (дольше порога) → storage degraded, система degraded, запрос отменён', async () => {
    vi.useFakeTimers();
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
    // S3 «висит», пока таймаут не отменит запрос — как настоящий abortSignal в send.
    s3Mock.getS3ClientForHealth.mockImplementation(
      (signal?: AbortSignal) =>
        new Promise<boolean>((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new Error('aborted'));
            return;
          }
          signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    const { checkSystemStatus } = await import('../health-tracker');
    const pending = checkSystemStatus();
    await vi.advanceTimersByTimeAsync(STORAGE_CHECK_TIMEOUT_MS);

    const status = await pending;

    expect(status.components.storage).toEqual({ status: 'degraded', provider: 's3' });
    expect(status.status).toBe('degraded');
    expect(abortSpy).toHaveBeenCalled();

    abortSpy.mockRestore();
  });

  it('явная ошибка S3 (исключение) → storage down, система unhealthy', async () => {
    s3Mock.getS3ClientForHealth.mockRejectedValue(new Error('S3 connection refused'));

    const { checkSystemStatus } = await import('../health-tracker');
    const status = await checkSystemStatus();

    expect(status.components.storage).toEqual({ status: 'down', provider: 's3' });
    expect(status.status).toBe('unhealthy');
  });

  it('ok=false (S3 недоступен) → storage down, система unhealthy', async () => {
    s3Mock.getS3ClientForHealth.mockResolvedValue(false);

    const { checkSystemStatus } = await import('../health-tracker');
    const status = await checkSystemStatus();

    expect(status.components.storage).toEqual({ status: 'down', provider: 's3' });
    expect(status.status).toBe('unhealthy');
  });
});

/*
  Пульс планировщиков (F-HEALTH-SCHEDULERS).

  F-SCHEDULER-HEARTBEAT научил суточные/часовые планировщики писать
  `system:scheduler:<имя>` с TTL в три интервала, но читать эти ключи было
  некому: остановка контейнера workers означала тихое прекращение суточной
  рутины, невидимое ни /api/health, ни метрикам (R59 #1, #2).

  Три случая: все ключи живы; один истёк (это и есть остановившийся прогон);
  инстанс состояния недоступен — проверка не бросает.
*/
describe('планировщики: истёкший пульс виден и даёт degraded (F-HEALTH-SCHEDULERS)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stateClient.available = true;
    mocks.queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    mocks.outboxStats.mockResolvedValue({ unpublished: 0, failed: 0, total: 0 });
    mocks.dlqStats.mockResolvedValue({ pending: 0 });
    mocks.lagMetrics.mockReturnValue(null);
    mocks.redisPing.mockResolvedValue('PONG');
    mocks.statePing.mockResolvedValue('PONG');
    mocks.redisSmembers.mockResolvedValue(['outbox']);
    mocks.stateSmembers.mockResolvedValue(['outbox']);
    // Кэш пульса планировщиков не знает — он лежит в инстансе состояния.
    mocks.redisGet.mockResolvedValue(null);
    mocks.stateGet.mockImplementation(async (key: string) =>
      key === 'system:worker:heartbeat:outbox' ? String(Date.now()) : freshSchedulerHeartbeat(key));
    mocks.readdir.mockRejectedValue(new Error('missing backup directory'));
    delete process.env.BACKUP_ENABLED;
    // Уборка ключей идемпотентности — opt-in (F-IDEMP-CLEANUP-OPTIN): по
    // умолчанию её нет, и её пульса в списке требуемых быть не должно.
    delete process.env.IDEMPOTENCY_CLEANUP_ENABLED;
  });

  afterEach(() => {
    delete process.env.IDEMPOTENCY_CLEANUP_ENABLED;
  });

  it('все ключи живы → schedulers ok, система здорова', async () => {
    const { checkSystemStatus } = await import('../health-tracker');

    const status = await checkSystemStatus();

    expect(status.components.schedulers).toEqual({ status: 'ok', stale: [] });
    expect(status.status).toBe('healthy');
  });

  it('ключ одного планировщика истёк → stale с его именем, общий статус degraded', async () => {
    mocks.stateGet.mockImplementation(async (key: string) => {
      if (key === 'system:worker:heartbeat:outbox') return String(Date.now());
      // Проходы пересборки проекций прекратились — TTL ключа истёк.
      if (key === 'system:scheduler:projection-rebuild') return null;
      return freshSchedulerHeartbeat(key);
    });

    const { checkSystemStatus } = await import('../health-tracker');

    const status = await checkSystemStatus();

    expect(status.components.schedulers.status).toBe('stale');
    expect(status.components.schedulers.stale).toEqual(['projection-rebuild']);
    // Суточная рутина встала, но приложение работает: degraded, а не unhealthy —
    // иначе мониторинг получал бы 503 и поднимал бы на уши напрасно.
    expect(status.status).toBe('degraded');
  });

  it('пульс, попавший в кэш вместо состояния, планировщика не воскрешает', async () => {
    // Ровно продовая ловушка двух Redis: ключ есть, но не в том инстансе.
    mocks.redisGet.mockImplementation(async (key: string) =>
      key.startsWith('system:scheduler:') ? new Date().toISOString() : null);
    mocks.stateGet.mockImplementation(async (key: string) =>
      key === 'system:worker:heartbeat:outbox' ? String(Date.now()) : null);

    const { checkSystemStatus } = await import('../health-tracker');

    const status = await checkSystemStatus();

    expect(mocks.stateGet).toHaveBeenCalledWith('system:scheduler:pm-scheduler');
    expect(status.components.schedulers.status).toBe('stale');
  });

  it('недоступный инстанс состояния не бросает и не выглядит благополучием', async () => {
    mocks.stateClient.available = false;

    const { checkSystemStatus } = await import('../health-tracker');

    const status = await checkSystemStatus();

    // Нет данных о пульсе — это не «всё в порядке»: планировщики считаются stale.
    expect(status.components.schedulers.status).toBe('stale');
    // Уборки ключей идемпотентности в списке нет: она выключена по умолчанию
    // (F-IDEMP-CLEANUP-OPTIN) и пульса не пишет — требовать его нельзя.
    expect(status.components.schedulers.stale).toEqual([
      'pm-scheduler',
      'projection-rebuild',
      'readiness-scheduler',
    ]);
  });

  it('выключенная уборка ключей не в счёте: её пульс не спрашивают и не ждут', async () => {
    // Значение, которое владелец мог задать «на всякий случай», уборку не
    // включает: opt-in — только строка 'true' (F-IDEMP-CLEANUP-OPTIN).
    process.env.IDEMPOTENCY_CLEANUP_ENABLED = '1';
    mocks.stateGet.mockImplementation(async (key: string) => {
      if (key === 'system:worker:heartbeat:outbox') return String(Date.now());
      // Единственный ключ, которого на проде нет: уборка выключена.
      if (key === 'system:scheduler:idempotency-cleanup') return null;
      return freshSchedulerHeartbeat(key);
    });

    const { checkSystemStatus } = await import('../health-tracker');

    const status = await checkSystemStatus();

    expect(status.components.schedulers).toEqual({ status: 'ok', stale: [] });
    expect(status.status).toBe('healthy');
    expect(mocks.stateGet).not.toHaveBeenCalledWith('system:scheduler:idempotency-cleanup');
  });

  it("явно включённая уборка ключей требует пульса: без него stale (F-IDEMP-CLEANUP-OPTIN)", async () => {
    process.env.IDEMPOTENCY_CLEANUP_ENABLED = 'true';
    mocks.stateGet.mockImplementation(async (key: string) => {
      if (key === 'system:worker:heartbeat:outbox') return String(Date.now());
      if (key === 'system:scheduler:idempotency-cleanup') return null;
      return freshSchedulerHeartbeat(key);
    });

    const { checkSystemStatus } = await import('../health-tracker');

    const status = await checkSystemStatus();

    expect(status.components.schedulers).toEqual({
      status: 'stale',
      stale: ['idempotency-cleanup'],
    });
    expect(status.status).toBe('degraded');
    expect(mocks.stateGet).toHaveBeenCalledWith('system:scheduler:idempotency-cleanup');
  });
});

describe('F6 review7: health snapshot survives a second module instance', () => {
  it('reads the snapshot collected by the producer rather than null', async () => {
    const producer = await import('../health-tracker/tracker');
    const produced = await producer.getFreshStatus();
    vi.resetModules();
    const consumer = await import('../health-tracker/tracker');
    expect(consumer.getCurrentStatus()).toEqual(produced);
  });
});
