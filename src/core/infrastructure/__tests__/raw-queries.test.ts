/**
 * Raw Queries — Regression tests.
 *
 * Guards against the $4 SQL syntax bug (2026-04): nested Prisma.sql
 * fragments produced malformed positional params under Turbopack, breaking
 * /api/reports/pdf in the field. The fix was to use db.report.findMany
 * instead of raw SQL. These tests pin the findMany contract so a future
 * revert to raw SQL fails loudly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findManyMock, queryRawMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  queryRawMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    report: { findMany: findManyMock },
    $queryRaw: queryRawMock,
  },
}));

vi.mock('@/generated/postgres-client', () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import {
  getReportsByPeriodRaw,
  PERIOD_REPORTS_LIMIT,
} from '../raw-queries';

describe('getReportsByPeriodRaw', () => {
  beforeEach(() => {
    findManyMock.mockReset();
    findManyMock.mockResolvedValue([]);
  });

  it('builds where clause with tenantId, date range, and siteId', async () => {
    await getReportsByPeriodRaw('tenant-1', '2026-04-01', '2026-04-30', 'site-1');

    expect(findManyMock).toHaveBeenCalledTimes(1);
    const args = findManyMock.mock.calls[0][0];
    expect(args.where).toEqual({
      tenantId: 'tenant-1',
      date: { gte: '2026-04-01', lte: '2026-04-30' },
      siteId: 'site-1',
    });
    expect(args.orderBy).toEqual({ date: 'desc' });
    expect(args.take).toBe(PERIOD_REPORTS_LIMIT + 1);
  });

  it('omits siteId filter when not provided', async () => {
    await getReportsByPeriodRaw('tenant-1', '2026-04-01', '2026-04-30');

    const args = findManyMock.mock.calls[0][0];
    expect(args.where).not.toHaveProperty('siteId');
  });

  it('omits siteId filter when null', async () => {
    await getReportsByPeriodRaw('tenant-1', '2026-04-01', '2026-04-30', null);

    const args = findManyMock.mock.calls[0][0];
    expect(args.where).not.toHaveProperty('siteId');
  });

  // R26-1: пустая организация раньше превращалась в `tenantId IS NULL` —
  // вместо отказа запрос отдавал строки без организации. Правило проекта
  // (CLAUDE.md): отказ, а не «общая область».
  it('refuses an empty tenantId instead of querying (fail closed)', async () => {
    await expect(getReportsByPeriodRaw('', '2026-04-01', '2026-04-30')).rejects.toThrow();
    await expect(getReportsByPeriodRaw('   ', '2026-04-01', '2026-04-30')).rejects.toThrow();
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('includes child aggregations (piles, drillings, downtimes)', async () => {
    await getReportsByPeriodRaw('tenant-1', '2026-04-01', '2026-04-30');

    const args = findManyMock.mock.calls[0][0];
    expect(args.include).toMatchObject({
      piles: expect.any(Object),
      drillings: expect.any(Object),
      downtimes: expect.any(Object),
    });
  });

  it('throws 422 instead of silently truncating a period over the limit', async () => {
    findManyMock.mockResolvedValue(
      Array.from({ length: PERIOD_REPORTS_LIMIT + 1 }, (_, index) => ({ id: `report-${index}` }))
    );

    await expect(
      getReportsByPeriodRaw('tenant-1', '2026-04-01', '2026-04-30')
    ).rejects.toMatchObject({
      status: 422,
      message: 'За выбранный период больше 2000 отчётов — сузьте период или выберите объект',
    });
  });
});
