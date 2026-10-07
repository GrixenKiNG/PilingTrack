import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type EventRow = {
  published: boolean;
  projected: boolean;
  createdAt: Date;
  publishedAt: Date | null;
  nextRetryAt: Date | null;
};

const mocks = vi.hoisted(() => ({
  rows: [] as EventRow[],
  aggregate: vi.fn(),
  findFirst: vi.fn(),
  count: vi.fn(),
  queryRaw: vi.fn(),
  leader: { getLeader: vi.fn(async () => 'worker-1'), isLeader: vi.fn(() => true) },
}));

vi.mock('@/lib/db', () => ({
  db: { outboxEvent: { aggregate: mocks.aggregate, findFirst: mocks.findFirst, count: mocks.count }, $queryRaw: mocks.queryRaw },
}));
// Фоновая сверка обходит организации по очереди (RLS fail-closed) — здесь одна.
vi.mock('@/lib/tenant-iteration', () => ({
  forEachTenant: async (fn: (tenantId: string) => Promise<unknown>) => [await fn('orion')],
}));
vi.mock('@/core/infrastructure/leader-election', () => ({
  getOutboxLeaderElection: () => mocks.leader,
  getProjectionLeaderElection: () => mocks.leader,
}));
vi.mock('@/core/outbox/dead-letter-queue', () => ({ getDlqStats: async () => ({ pending: 0 }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { getFreshLagMetrics, getLagMetrics, exportPrometheusMetrics, countReportAnalyticsStatusMismatch } from '../lag-monitor';

const NOW = new Date('2026-10-02T10:00:00Z');

function event(overrides: Partial<EventRow> = {}): EventRow {
  return {
    published: true,
    projected: false,
    createdAt: new Date(NOW.getTime() - 120_000),
    publishedAt: new Date(NOW.getTime() - 60_000),
    nextRetryAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mocks.rows = [];
  mocks.aggregate.mockReset().mockImplementation(async ({ where }: { where: { projected: boolean } }) => {
    const rows = mocks.rows.filter(row => row.projected === where.projected);
    return {
      _count: { _all: rows.length },
      _min: { createdAt: rows.length ? new Date(Math.min(...rows.map(row => row.createdAt.getTime()))) : null },
    };
  });
  mocks.findFirst.mockReset().mockImplementation(async () => {
    const rows = mocks.rows.filter(row => !row.published).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return rows.length ? { createdAt: rows[0].createdAt } : null;
  });
  mocks.count.mockReset().mockImplementation(async ({ where }: { where: { published: boolean; publishedAt?: { gte: Date } } }) =>
    mocks.rows.filter(row => row.published === where.published &&
      (!where.publishedAt || (row.publishedAt !== null && row.publishedAt >= where.publishedAt.gte))).length);
  mocks.queryRaw.mockReset().mockResolvedValue([{ statusMismatch: 0, missingAnalytics: 0 }]);
});

afterEach(() => vi.useRealTimers());

describe('independent projection backlog', () => {
  it('observes a published event still waiting for projection while publication lag is zero', async () => {
    mocks.rows = [event(), event({ projected: true, published: false, createdAt: NOW })];
    const metrics = await getFreshLagMetrics();
    expect(metrics.outboxLagSeconds).toBe(0);
    expect(metrics.projectionLagSeconds).toBe(120);
    expect(metrics.projectionPendingCount).toBe(1);
  });

  it('includes retry backoff and excludes consumed events, including DLQ-consumed flags', async () => {
    mocks.rows = [
      event({ nextRetryAt: new Date(NOW.getTime() + 600_000) }),
      event({ published: false, createdAt: new Date(NOW.getTime() - 30_000) }),
      event({ projected: true, createdAt: new Date(NOW.getTime() - 900_000) }),
    ];
    const metrics = await getFreshLagMetrics();
    expect(metrics.projectionLagSeconds).toBe(120);
    expect(metrics.projectionPendingCount).toBe(2);
    expect(mocks.aggregate).toHaveBeenCalledExactlyOnceWith({
      where: { projected: false }, _count: { _all: true }, _min: { createdAt: true },
    });
  });

  it.each([{ rows: [] }, { rows: [event({ projected: true })] }])('reports zero for no pending projection: %j', async ({ rows }) => {
    mocks.rows = rows;
    const metrics = await getFreshLagMetrics();
    expect(metrics.projectionLagSeconds).toBe(0);
    expect(metrics.projectionPendingCount).toBe(0);
  });

  it('clamps future creation time to zero age while preserving pending count', async () => {
    mocks.rows = [event({ createdAt: new Date(NOW.getTime() + 120_000) })];
    const metrics = await getFreshLagMetrics();
    expect(metrics.projectionLagSeconds).toBe(0);
    expect(metrics.projectionPendingCount).toBe(1);
  });

  it('rejects a failed aggregate and preserves the previous snapshot and its timestamp', async () => {
    mocks.rows = [event()];
    const previous = await getFreshLagMetrics();
    vi.setSystemTime(new Date(NOW.getTime() + 120_000));
    mocks.aggregate.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(getFreshLagMetrics()).rejects.toThrow('database unavailable');
    expect(getLagMetrics()).toBe(previous);
    expect(getLagMetrics()?.timestamp).toBe(NOW.toISOString());
  });
});

describe('lag scrape freshness', () => {
  it('exports only a missing-snapshot timestamp before collection', async () => {
    const output = exportPrometheusMetrics(null);
    expect(output).toContain('# TYPE lag_snapshot_timestamp_seconds gauge');
    expect(output).toContain('lag_snapshot_timestamp_seconds 0');
    expect(output).not.toContain('projection_lag_seconds 0');
  });

  it('exports actual projection age, count and successful collection time', async () => {
    mocks.rows = [event()];
    const output = exportPrometheusMetrics(await getFreshLagMetrics());
    expect(output).toContain('# HELP projection_lag_seconds Age of oldest outbox event not yet projected');
    expect(output).toContain('projection_lag_seconds 120');
    expect(output).toContain('projection_pending_count 1');
    expect(output.endsWith('\n')).toBe(true);
    expect(output).toContain('lag_snapshot_timestamp_seconds ' + NOW.getTime() / 1000);
  });

  it('exports unavailable timestamp for an invalid snapshot date', async () => {
    const metrics = await getFreshLagMetrics();
    expect(exportPrometheusMetrics({ ...metrics, timestamp: 'invalid' })).toContain('lag_snapshot_timestamp_seconds 0');
  });
});

// J5: сверка статуса отчёта и его строки аналитики. Витрину пишут события, и при
// потерянном ReportSubmitted строка молча остаётся в старом статусе — на экранах
// такого дрейфа проекции не видно, сигнал даёт метрика мониторинга.
describe('report/analytics status reconciliation', () => {
  it('counts mismatches of the mock row and refuses an empty tenant without querying', async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ statusMismatch: 4, missingAnalytics: 2 }]);
    expect(await countReportAnalyticsStatusMismatch('orion')).toEqual({ statusMismatch: 4, missingAnalytics: 2 });

    mocks.queryRaw.mockClear();
    await expect(countReportAnalyticsStatusMismatch('')).rejects.toThrow();
    await expect(countReportAnalyticsStatusMismatch('   ')).rejects.toThrow();
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it('scopes the query to the tenant with strict equality, never a fail-open tenantId IS NULL', async () => {
    await countReportAnalyticsStatusMismatch('orion');

    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = mocks.queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    const sql = strings.join('');
    expect(sql).toContain('r."tenantId" =');
    expect(sql).not.toContain('r."tenantId" IS NULL');
    expect(values).toContain('orion');
  });

  it('exposes the mismatch and missing-row gauges from the reconciliation query', async () => {
    mocks.queryRaw.mockResolvedValue([{ statusMismatch: 3, missingAnalytics: 2 }]);
    const metrics = await getFreshLagMetrics();
    expect(metrics.reportAnalyticsStatusMismatchCount).toBe(3);
    expect(metrics.reportAnalyticsMissingCount).toBe(2);

    const output = exportPrometheusMetrics(metrics);
    expect(output).toContain('# TYPE report_analytics_status_mismatch_total gauge');
    expect(output).toContain('report_analytics_status_mismatch_total 3');
    expect(output).toContain('report_analytics_missing_total 2');
  });

  it('reports zero when the reconciliation query fails, leaving other metrics intact', async () => {
    mocks.rows = [event()];
    mocks.queryRaw.mockRejectedValueOnce(new Error('database unavailable'));
    const metrics = await getFreshLagMetrics();
    expect(metrics.reportAnalyticsStatusMismatchCount).toBe(0);
    expect(metrics.reportAnalyticsMissingCount).toBe(0);
    expect(metrics.projectionPendingCount).toBe(1);
  });
});

it('F6 review7: a second module instance reads the producer lag snapshot', async () => {
  const produced = await getFreshLagMetrics();
  vi.resetModules();
  const consumer = await import('../lag-monitor');
  expect(consumer.getLagMetrics()).toEqual(produced);
});
