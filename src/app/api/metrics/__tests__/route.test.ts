/**
 * GET /api/metrics — service-to-service scrape token (M-10b).
 *
 * /api/metrics required a real user session (requireAuth + assertCan
 * 'system.read'), but Prometheus's static scrape_configs can't do session
 * login — there's no cookie jar, no JWT refresh flow. Production shipped
 * with the 'pilingtrack-app' scrape job commented out in
 * observability/prometheus/prometheus-prod.yml specifically because of
 * this (see the TODO M-10b left there), so metrics were never collected.
 *
 * Fix: a separate static secret (METRICS_SCRAPE_TOKEN) checked via
 * Authorization: Bearer, constant-time compared (mirrors the existing
 * pattern in /api/alerts/webhook and auth-service.ts's constantTimeEquals —
 * this is the same secret-comparison class of bug). A valid token bypasses
 * the session check entirely; anything else (wrong token, no token,
 * env var unset) falls through to the existing session-based auth
 * unchanged, so a logged-in admin can still open /api/metrics in a
 * browser for debugging.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SystemStatus } from '@/core/observability/health-tracker';

const { requireAuthMock, assertCanMock, getCurrentStatusMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  assertCanMock: vi.fn(),
  getCurrentStatusMock: vi.fn<() => SystemStatus | null>(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/services/auth/authorization-service', async () => {
  const actual = await vi.importActual<object>('@/services/auth/authorization-service');
  return { ...actual, assertCan: assertCanMock };
});
vi.mock('@/lib/cache-metrics', () => ({ generatePrometheusMetrics: () => '# cache metrics\n' }));
vi.mock('@/core/observability/lag-monitor', () => ({
  getLagMetrics: () => null,
  exportPrometheusMetrics: () => '',
}));
vi.mock('@/core/observability/health-tracker', () => ({ getCurrentStatus: getCurrentStatusMock }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { GET } from '../route';

const TOKEN = 'super-secret-scrape-token';
const AUTH_ERROR = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

function req(token: string | null): NextRequest {
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new NextRequest('http://localhost/api/metrics', { headers });
}

describe('GET /api/metrics — scrape token auth', () => {
  const originalEnv = process.env.METRICS_SCRAPE_TOKEN;

  beforeEach(() => {
    requireAuthMock.mockReset();
    assertCanMock.mockReset();
    getCurrentStatusMock.mockReset().mockReturnValue(null);
    process.env.METRICS_SCRAPE_TOKEN = TOKEN;
  });
  afterEach(() => {
    process.env.METRICS_SCRAPE_TOKEN = originalEnv;
    vi.restoreAllMocks();
  });

  it('accepts a matching Bearer scrape token WITHOUT calling requireAuth/assertCan', async () => {
    const res = await GET(req(TOKEN));
    expect(res.status).toBe(200);
    expect(requireAuthMock).not.toHaveBeenCalled();
    expect(assertCanMock).not.toHaveBeenCalled();
  });

  it('falls back to session auth on a mismatched token', async () => {
    requireAuthMock.mockResolvedValue({ user: null, error: AUTH_ERROR });
    const res = await GET(req('wrong-token'));
    expect(res.status).toBe(401);
    expect(requireAuthMock).toHaveBeenCalled();
  });

  it('falls back to session auth on a token of different length (constant-time path correctness)', async () => {
    requireAuthMock.mockResolvedValue({ user: null, error: AUTH_ERROR });
    const res = await GET(req('short'));
    expect(res.status).toBe(401);
  });

  it('falls back to session auth when no token header is present', async () => {
    requireAuthMock.mockResolvedValue({ user: null, error: AUTH_ERROR });
    const res = await GET(req(null));
    expect(res.status).toBe(401);
  });

  it('never bypasses when METRICS_SCRAPE_TOKEN is unset — fails closed', async () => {
    delete process.env.METRICS_SCRAPE_TOKEN;
    requireAuthMock.mockResolvedValue({ user: null, error: AUTH_ERROR });
    const res = await GET(req(TOKEN));
    expect(res.status).toBe(401);
    expect(requireAuthMock).toHaveBeenCalled();
  });

  it('still serves a logged-in admin via the existing session path (no token header at all)', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' }, error: null });
    assertCanMock.mockImplementation(() => {}); // allowed, no throw
    const res = await GET(req(null));
    expect(res.status).toBe(200);
    expect(assertCanMock).toHaveBeenCalledWith({ id: 'u1', role: 'ADMIN' }, 'system.read');
  });

  it('still enforces system.read for a session without the right permission', async () => {
    const { ServiceError } = await import('@/lib/service-error');
    requireAuthMock.mockResolvedValue({ user: { id: 'u2', role: 'OPERATOR' }, error: null });
    assertCanMock.mockImplementation(() => { throw new ServiceError('Доступ запрещён', 403); });
    const res = await GET(req(null));
    expect(res.status).toBe(403);
  });
});


function healthStatus(
  backup: SystemStatus['components']['backup'] = { status: 'up', source: 'disabled' },
  status: SystemStatus['status'] = 'healthy',
  timestamp = new Date(Date.now() - 90_000).toISOString(),
): SystemStatus {
  return {
    status, timestamp, version: 'test',
    components: {
      database: { status: 'up' }, redis: { status: 'up' },
      outbox: { status: 'ok', pendingCount: 0 }, workers: { status: 'running' },
      schedulers: { status: 'ok', stale: [] }, storage: { status: 'up', provider: 'local' }, backup,
    },
    metrics: { uptime: 0, memoryUsage: process.memoryUsage(), outboxPending: 0, dlqPending: 0 },
  };
}

describe('GET /api/metrics — наблюдаемость health и резервных копий', () => {
  beforeEach(() => {
    vi.stubEnv('METRICS_SCRAPE_TOKEN', TOKEN);
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-02T00:00:00Z'));
    getCurrentStatusMock.mockReset().mockReturnValue(null);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it.each([['healthy', 0], ['degraded', 1], ['unhealthy', 2]] as const)('отдаёт статус %s и возраст снимка без нового опроса', async (status, value) => {
    getCurrentStatusMock.mockReturnValue(healthStatus(undefined, status));
    const text = await (await GET(req(TOKEN))).text();
    expect(text).toContain(`health_status ${value}\n`);
    expect(text).toContain('health_snapshot_age_seconds 90\n');
  });

  it.each([null, 'invalid-timestamp'])('помечает недоступный снимок возрастом -1 (%s)', async (timestamp) => {
    getCurrentStatusMock.mockReturnValue(timestamp === null ? null : healthStatus(undefined, 'healthy', timestamp));
    const text = await (await GET(req(TOKEN))).text();
    expect(text).toContain('health_snapshot_age_seconds -1\n');
    expect(text).not.toContain('NaN');
  });

  it('различает выключенный контроль бэкапов и отсутствие успешной копии', async () => {
    getCurrentStatusMock.mockReturnValue(healthStatus());
    let text = await (await GET(req(TOKEN))).text();
    expect(text).toContain('backup_monitoring_enabled 0\n');
    expect(text).toContain('backup_last_success_available 0\n');

    getCurrentStatusMock.mockReturnValue(healthStatus({ status: 'slow', source: 'missing' }));
    text = await (await GET(req(TOKEN))).text();
    expect(text).toContain('backup_monitoring_enabled 1\n');
    expect(text).toContain('backup_last_success_available 0\n');
  });

  it.each([0, 49])('считает копию возрастом %s ч доступной, включая только что созданную', async (age) => {
    getCurrentStatusMock.mockReturnValue(healthStatus({ status: 'up', source: 'redis', lastBackupAgeHours: age, s3Synced: false }));
    const text = await (await GET(req(TOKEN))).text();
    expect(text).toContain('backup_monitoring_enabled 1\n');
    expect(text).toContain('backup_last_success_available 1\n');
    expect(text).toContain(`backup_age_hours ${age}\n`);
  });

  it.each([NaN, Infinity, -1])('не публикует некорректный возраст копии как успешный (%s)', async (age) => {
    getCurrentStatusMock.mockReturnValue(healthStatus({ status: 'down', source: 'redis', lastBackupAgeHours: age }));
    const text = await (await GET(req(TOKEN))).text();
    expect(text).toContain('backup_last_success_available 0\n');
    expect(text).toContain('backup_age_hours 0\n');
  });
});

describe('Правила Prometheus — реальные источники и защита от ложных тревог', () => {
  const rules = readFileSync(join(process.cwd(), 'observability/prometheus/alerts.yml'), 'utf8');
  function expression(alert: string): string {
    const block = rules.split(`- alert: ${alert}\n`)[1] ?? rules.split(`- alert: ${alert}\r\n`)[1];
    expect(block, `Правило ${alert} должно существовать`).toBeDefined();
    return block?.split('- alert:')[0].match(/^\s*expr: (.+)$/m)?.[1].trim() ?? '';
  }

  it('не считает отключённый worker отказавшим и сопоставляет его имя', () => {
    expect(expression('WorkerNotRunning')).toContain('worker_status{job="pilingtrack-workers"} == 0');
    expect(expression('WorkerNotRunning')).toContain('and on(job, instance, name) worker_enabled{job="pilingtrack-workers"} == 1');
  });

  it('бэкапы имеют отдельные тревоги для отсутствия, старения и облачной копии', () => {
    expect(expression('BackupMissing')).toContain('backup_last_success_available{job="pilingtrack-app"} == 0');
    expect(expression('BackupStale')).toContain('backup_age_hours{job="pilingtrack-app"} > 26');
    expect(expression('BackupCritical')).toContain('backup_age_hours{job="pilingtrack-app"} > 48');
    for (const name of ['BackupMissing', 'BackupStale', 'BackupCritical', 'OffsiteBackupNotSynced']) {
      expect(expression(name)).toContain('and on(job, instance) backup_monitoring_enabled{job="pilingtrack-app"} == 1');
    }
    expect(expression('OffsiteBackupNotSynced')).toContain('and on(job, instance) backup_last_success_available{job="pilingtrack-app"} == 1');
  });

  it('поднимает тревогу при устаревшем и недоступном health-снимке, а также деградации', () => {
    expect(expression('HealthSnapshotStale')).toContain('health_snapshot_age_seconds{job="pilingtrack-app"} > 60');
    expect(expression('HealthSnapshotStale')).toContain('health_snapshot_age_seconds{job="pilingtrack-app"} < 0');
    expect(expression('HealthDegraded')).toContain('health_status{job="pilingtrack-app"} > 0');
  });

  it('считает подключения всего экземпляра Postgres, не угадывая имя рабочей базы', () => {
    for (const name of ['PostgresHighConnectionCount', 'PostgresConnectionPoolExhausted']) {
      expect(expression(name)).toContain('sum by(job, instance) (pg_stat_activity_count{job="postgresql"})');
      expect(expression(name)).not.toContain('datname="pilingtrack"');
    }
    expect(expression('PostgresHighConnectionCount')).toMatch(/> 160$/);
    expect(expression('PostgresConnectionPoolExhausted')).toMatch(/> 190$/);
    expect(expression('PostgresDeadlocks')).toContain('pg_stat_database_deadlocks{job="postgresql",datname!~"template0|template1|postgres"}');
  });
  it('Redis без maxmemory не даёт деления на ноль, диск использует root label node-exporter', () => {
    expect(expression('RedisHighMemory')).toContain('and on(job, instance) redis_memory_max_bytes > 0');
    for (const name of ['HostDiskSpaceLow', 'HostDiskSpaceCritical']) {
      expect(expression(name)).toContain('job="node",mountpoint="/"');
      expect(expression(name)).not.toContain('mountpoint="/host"');
    }
  });
});
