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
  getCrewsWithDetailsRaw,
  upsertReportRaw,
  PERIOD_REPORTS_LIMIT,
  getSiteDailySummaryRaw,
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

// R65 #2: getCrewsWithDetailsRaw раньше шёл без арендного условия и отдавал
// e-mail машинистов всех активных бригад системы. У «Crew» нет своей колонки
// tenantId — организация наследуется от объекта, поэтому фильтр идёт по Site.
describe('getCrewsWithDetailsRaw', () => {
  beforeEach(() => {
    queryRawMock.mockReset();
    queryRawMock.mockResolvedValue([]);
  });

  it('refuses an empty or non-string tenantId instead of querying (fail closed)', async () => {
    await expect(getCrewsWithDetailsRaw('')).rejects.toThrow();
    await expect(getCrewsWithDetailsRaw('   ')).rejects.toThrow();
    await expect(
      getCrewsWithDetailsRaw(undefined as unknown as string)
    ).rejects.toThrow();
    expect(queryRawMock).not.toHaveBeenCalled();
  });

  it('scopes the query to the tenant with a strict condition on Site', async () => {
    await getCrewsWithDetailsRaw('tenant-1');

    expect(queryRawMock).toHaveBeenCalledTimes(1);
    const strings = queryRawMock.mock.calls[0][0] as TemplateStringsArray;
    const sql = strings.join('');
    // strict equality on the owning site, never a fail-open IS NULL
    expect(sql).toContain('s."tenantId" =');
    expect(sql).not.toContain('IS NULL');
    const values = queryRawMock.mock.calls[0].slice(1);
    expect(values).toContain('tenant-1');
  });

  it('still applies the optional siteId filter', async () => {
    await getCrewsWithDetailsRaw('tenant-1', 'site-1');

    const values = queryRawMock.mock.calls[0].slice(1);
    const fragment = values.find(
      (value): value is { strings: string[]; values: unknown[] } =>
        !!value && typeof value === 'object' && 'values' in value
    );
    expect(fragment?.values).toContain('site-1');
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

it('I05: raw daily summary requires the submitted status bound into SQL', async () => {
  queryRawMock.mockReset().mockResolvedValue([]);
  await getSiteDailySummaryRaw('site-1', '2026-10-01', '2026-10-02');
  const [strings, ...values] = queryRawMock.mock.calls[0];
  expect(strings.join('?')).toContain('r.status = ?');
  expect(values).toContain('submitted');
});