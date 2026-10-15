import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  userCount: vi.fn(),
  provider: vi.fn(() => 'postgres' as 'sqlite' | 'postgres'),
  stats: vi.fn(),
  tenant: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: { $queryRaw: mocks.queryRaw, user: { count: mocks.userCount } },
  getDatabaseProvider: mocks.provider,
}));
vi.mock('@/lib/rate-limiter', () => ({ rateLimiter: { getStats: mocks.stats } }));
vi.mock('@/services/tenancy/tenant-context-service', () => ({ resolveTenantContext: mocks.tenant }));

import { getReadinessStatus, getRuntimeDiagnostics } from '../system-service';
import * as publicApi from '../../..';

describe('system: getRuntimeDiagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.provider.mockReturnValue('postgres');
    mocks.tenant.mockReturnValue({ mode: 'single', tenantId: 'orion' });
    mocks.stats.mockResolvedValue({ blocked: 2 });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('отдаёт провайдера базы, организацию, статистику лимитера и сведения о среде', async () => {
    const result = await getRuntimeDiagnostics();

    expect(result).toMatchObject({
      databaseProvider: 'postgres',
      tenant: { mode: 'single', tenantId: 'orion' },
      rateLimiter: { blocked: 2 },
      runtime: { platform: process.platform },
    });
    expect(result.runtime.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('Sentry «настроен» только при DSN или токене и не раскрывает значения', async () => {
    vi.stubEnv('SENTRY_DSN', '');
    vi.stubEnv('SENTRY_AUTH_TOKEN', '');
    expect((await getRuntimeDiagnostics()).sentry.configured).toBe(false);

    vi.stubEnv('SENTRY_DSN', 'https://secret@sentry.example/1');
    const configured = await getRuntimeDiagnostics();
    expect(configured.sentry.configured).toBe(true);
    expect(JSON.stringify(configured)).not.toContain('secret@');
  });

  it('публичный вход модуля отдаёт ту же функцию', () => {
    expect(publicApi.getRuntimeDiagnostics).toBe(getRuntimeDiagnostics);
  });
});

describe('system: getReadinessStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.provider.mockReturnValue('postgres');
    mocks.tenant.mockReturnValue({ mode: 'single', tenantId: 'orion' });
    mocks.queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    vi.stubEnv('SESSION_SECRET', 'x'.repeat(32));
  });
  afterEach(() => vi.unstubAllEnvs());

  it('готов, когда база отвечает и задан секрет сессии', async () => {
    expect(await getReadinessStatus()).toEqual({
      ready: true,
      database: { provider: 'postgres', ok: true },
      session: { configured: true },
      tenant: { mode: 'single', tenantId: 'orion' },
    });
  });

  it('не готов при отказе базы и не бросает исключение', async () => {
    mocks.queryRaw.mockRejectedValue(new Error('connection refused'));

    const status = await getReadinessStatus();

    expect(status.ready).toBe(false);
    expect(status.database.ok).toBe(false);
  });

  it('не готов без секрета сессии, даже если база отвечает', async () => {
    vi.stubEnv('SESSION_SECRET', '');
    vi.stubEnv('AUTH_SECRET', '');

    const status = await getReadinessStatus();

    expect(status.database.ok).toBe(true);
    expect(status.session.configured).toBe(false);
    expect(status.ready).toBe(false);
  });

  it('на sqlite проверяет базу чтением, а не сырым запросом', async () => {
    mocks.provider.mockReturnValue('sqlite');
    mocks.userCount.mockResolvedValue(0);

    const status = await getReadinessStatus();

    expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(mocks.userCount).toHaveBeenCalled();
    expect(status.database).toEqual({ provider: 'sqlite', ok: true });
  });
});
