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

const { findManyMock } = vi.hoisted(() => ({ findManyMock: vi.fn() }));

vi.mock('@/lib/db', () => ({
  db: {
    report: { findMany: findManyMock },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { getReportsByPeriodRaw } from '../raw-queries';

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
    expect(args.take).toBe(500);
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

  it('coerces empty tenantId to null (global scope)', async () => {
    await getReportsByPeriodRaw('', '2026-04-01', '2026-04-30');

    const args = findManyMock.mock.calls[0][0];
    expect(args.where.tenantId).toBeNull();
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
});
