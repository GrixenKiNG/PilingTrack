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

const { findManyMock, queryRawMock, executeRawMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  queryRawMock: vi.fn(),
  executeRawMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    report: { findMany: findManyMock },
    $queryRaw: queryRawMock,
    $executeRaw: executeRawMock,
  },
}));

vi.mock('@/generated/postgres-client', () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    join: (items: unknown[]) => ({ joined: items }),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import {
  getReportsByPeriodRaw,
  upsertReportRaw,
  incrementReportCountersRaw,
  bulkDeleteReportsRaw,
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

describe('upsertReportRaw', () => {
  beforeEach(() => {
    queryRawMock.mockReset();
    queryRawMock.mockResolvedValue([{ id: 'internal-1' }]);
  });

  it('uses parameterised tagged template (not $queryRawUnsafe)', async () => {
    await upsertReportRaw({
      id: 'r1', tenantId: 't1', userId: 'u1', siteId: 's1',
      date: '2026-04-10', status: 'draft',
    });

    expect(queryRawMock).toHaveBeenCalledTimes(1);
    const [firstArg] = queryRawMock.mock.calls[0];
    // tagged-template invocation passes a TemplateStringsArray (has .raw)
    expect(Array.isArray(firstArg)).toBe(true);
    expect((firstArg as TemplateStringsArray).raw).toBeDefined();
  });

  it('passes all user-supplied values as template placeholders, never interpolated', async () => {
    const malicious = "'; DROP TABLE Report; --";
    await upsertReportRaw({
      id: malicious, tenantId: 't1', userId: 'u1', siteId: 's1',
      date: '2026-04-10', status: 'draft',
    });

    const [, ...values] = queryRawMock.mock.calls[0];
    expect(values).toContain(malicious);
    // SQL fragment must NOT contain the injection payload inline
    const strings = queryRawMock.mock.calls[0][0] as TemplateStringsArray;
    expect(strings.join('')).not.toContain(malicious);
  });

  it('defaults missing shiftType/shiftStart/shiftEnd/equipmentId', async () => {
    await upsertReportRaw({
      id: 'r1', tenantId: 't1', userId: 'u1', siteId: 's1',
      date: '2026-04-10', status: 'draft',
    });

    const [, ...values] = queryRawMock.mock.calls[0];
    expect(values).toContain('day');
    expect(values).toContain(null);
  });

  it('returns the first row from the RETURNING clause', async () => {
    queryRawMock.mockResolvedValueOnce([{ id: 'row-a', reportId: 'r1' }, { id: 'row-b' }]);
    const result = await upsertReportRaw({
      id: 'r1', tenantId: 't1', userId: 'u1', siteId: 's1',
      date: '2026-04-10', status: 'draft',
    });

    expect(result).toEqual({ id: 'row-a', reportId: 'r1' });
  });
});

describe('incrementReportCountersRaw', () => {
  beforeEach(() => {
    executeRawMock.mockReset();
    executeRawMock.mockResolvedValue(1);
  });

  it('uses parameterised tagged template for the UPDATE', async () => {
    await incrementReportCountersRaw('report-1', 5, 10, 0);

    expect(executeRawMock).toHaveBeenCalledTimes(1);
    const strings = executeRawMock.mock.calls[0][0] as TemplateStringsArray;
    expect(strings.raw).toBeDefined();
  });

  it('passes numeric deltas and reportId as template placeholders', async () => {
    await incrementReportCountersRaw('report-1', 5, 10, 0);

    const [, ...values] = executeRawMock.mock.calls[0];
    expect(values).toEqual([5, 10, 0, 'report-1']);
  });
});

describe('bulkDeleteReportsRaw', () => {
  beforeEach(() => {
    executeRawMock.mockReset();
    executeRawMock.mockResolvedValue(3);
  });

  it('short-circuits and returns 0 for an empty id list (never touches db)', async () => {
    const result = await bulkDeleteReportsRaw([]);
    expect(result).toBe(0);
    expect(executeRawMock).not.toHaveBeenCalled();
  });

  it('builds an ANY(ARRAY[...]) query using Prisma.join for ids', async () => {
    await bulkDeleteReportsRaw(['a', 'b', 'c']);

    expect(executeRawMock).toHaveBeenCalledTimes(1);
    const strings = executeRawMock.mock.calls[0][0] as TemplateStringsArray;
    expect(strings.raw).toBeDefined();
    // The joined-id Prisma fragment is passed as a placeholder value
    const values = executeRawMock.mock.calls[0].slice(1);
    expect(values.some((v) => typeof v === 'object' && v !== null && 'joined' in v)).toBe(true);
  });
});
