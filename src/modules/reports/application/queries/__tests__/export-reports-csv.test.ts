/**
 * exportReportsCsv — tenant scoping regression.
 *
 * Pre-existing IDOR: the where-clause built no tenantId filter at all, so
 * any authenticated user with `reports.export` could pull every tenant's
 * report data via /api/reports/export. Fail-closed fix mirrors the rest of
 * the codebase's tenant-scoping convention.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findManyMock } = vi.hoisted(() => ({ findManyMock: vi.fn() }));

vi.mock('@/lib/db', () => ({ db: { report: { findMany: findManyMock } } }));

import { exportReportsCsv } from '../report-query.service';

describe('exportReportsCsv — tenant scoping', () => {
  beforeEach(() => {
    findManyMock.mockReset();
    findManyMock.mockResolvedValue([]);
  });

  it('rejects when tenantId is missing (fail-closed IDOR guard)', async () => {
    await expect(exportReportsCsv({ tenantId: '' })).rejects.toThrow('tenantId is required');
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('scopes the query to the caller tenantId', async () => {
    await exportReportsCsv({ tenantId: 'tenant-a' });

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-a' }) })
    );
  });
});
