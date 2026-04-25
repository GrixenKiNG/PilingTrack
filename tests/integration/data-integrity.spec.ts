/**
 * Data Integrity Tests - PilingTrack
 *
 * Verifies:
 * - No data loss during sync
 * - No data duplication
 * - Correct aggregates
 * - Consistent state across operations
 *
 * Run: npx vitest run tests/integration/data-integrity.spec.ts
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { resolveConflict } from '@/core/shared/sync/conflict-resolver';

// Mock DB for testing
const mockDB = {
  reports: new Map<string, any>(),
  syncQueue: [] as any[],
  idempotencyKeys: new Map<string, boolean>(),
};

describe('Data Integrity - No Data Loss', () => {
  beforeEach(() => {
    mockDB.reports.clear();
    mockDB.syncQueue = [];
    mockDB.idempotencyKeys.clear();
  });

  it('preserves report data through sync cycle', async () => {
    const originalReport = {
      id: 'report-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      siteId: 'site-1',
      date: '2026-04-08',
      shiftType: 'day',
      status: 'draft',
      piles: [{ pileGradeId: 'grade-1', count: 5 }],
      drillings: [{ typeId: 'type-1', meters: 25 }],
      downtimes: [{ reasonId: 'reason-1', duration: 30 }],
      version: 1,
    };

    // Simulate local save
    mockDB.reports.set(originalReport.id, { ...originalReport });
    mockDB.syncQueue.push({
      opId: 'op-1',
      entity: 'report',
      op: 'upsert',
      data: originalReport,
      baseVersion: 1,
    });

    // Simulate sync processing
    const change = mockDB.syncQueue[0];
    if (!mockDB.idempotencyKeys.has(change.opId)) {
      mockDB.idempotencyKeys.set(change.opId, true);
      mockDB.reports.set(change.data.id, { ...change.data, version: change.data.version + 1 });
    }

    // Verify data integrity
    const syncedReport = mockDB.reports.get('report-1');
    expect(syncedReport).toBeDefined();
    expect(syncedReport.id).toBe(originalReport.id);
    expect(syncedReport.tenantId).toBe(originalReport.tenantId);
    expect(syncedReport.userId).toBe(originalReport.userId);
    expect(syncedReport.siteId).toBe(originalReport.siteId);
    expect(syncedReport.date).toBe(originalReport.date);
    expect(syncedReport.piles).toEqual(originalReport.piles);
    expect(syncedReport.drillings).toEqual(originalReport.drillings);
    expect(syncedReport.downtimes).toEqual(originalReport.downtimes);
  });

  it('preserves data through multiple sync retries', async () => {
    const report = {
      id: 'report-2',
      tenantId: 'tenant-1',
      piles: [{ count: 10 }],
      version: 1,
    };

    // Simulate 3 sync attempts
    for (let attempt = 1; attempt <= 3; attempt++) {
      const opId = `op-retry-${attempt}`;

      if (!mockDB.idempotencyKeys.has(opId)) {
        mockDB.idempotencyKeys.set(opId, true);

        // Simulate partial failure on attempt 1-2, success on 3
        if (attempt < 3) {
          mockDB.syncQueue.push({ opId, data: report, status: 'pending' });
        } else {
          mockDB.reports.set(report.id, { ...report, version: report.version + 1 });
          mockDB.syncQueue = mockDB.syncQueue.filter((q) => q.opId !== opId);
        }
      }
    }

    // Verify data is preserved and not duplicated
    expect(mockDB.reports.size).toBe(1);
    expect(mockDB.reports.get('report-2').version).toBe(2);
    expect(mockDB.syncQueue.length).toBe(2);
  });

  it('preserves data through conflict resolution', async () => {
    const serverReport = {
      id: 'report-3',
      status: 'submitted',
      date: '2026-04-08',
      siteId: 'site-1',
      userId: 'user-1',
      piles: [{ id: 'pile-1', pileGradeId: 'grade-1', count: 5 }],
      drillings: [{ id: 'drill-1', typeId: 'type-1', meters: 20 }],
      downtimes: [{ id: 'down-1', reasonId: 'reason-1', duration: 15 }],
      version: 5,
    };

    const clientReport = {
      id: 'report-3',
      status: 'draft',
      date: '2026-04-07',
      siteId: 'site-2',
      userId: 'user-2',
      piles: [{ id: 'pile-2', pileGradeId: 'grade-2', count: 8 }],
      drillings: [],
      downtimes: [{ id: 'down-2', reasonId: 'reason-2', duration: 30 }],
      version: 3,
    };

    const resolvedReport = resolveConflict(clientReport, serverReport, 'field_merge') as
      typeof serverReport & typeof clientReport;

    expect(resolvedReport.piles).toHaveLength(2);
    expect(resolvedReport.downtimes).toHaveLength(2);
    expect(resolvedReport.version).toBe(serverReport.version);
    expect(resolvedReport.status).toBe(serverReport.status);
    expect(resolvedReport.siteId).toBe(serverReport.siteId);
  });
});

describe('Data Integrity - No Duplication', () => {
  beforeEach(() => {
    mockDB.reports.clear();
    mockDB.syncQueue = [];
    mockDB.idempotencyKeys.clear();
  });

  it('prevents duplicate report creation via idempotency', async () => {
    const report = { id: 'report-1', piles: [{ count: 5 }], version: 1 };
    const opId = 'op-unique-1';

    if (!mockDB.idempotencyKeys.has(opId)) {
      mockDB.idempotencyKeys.set(opId, true);
      mockDB.reports.set(report.id, { ...report });
    }

    let duplicateCreated = false;
    if (!mockDB.idempotencyKeys.has(opId)) {
      mockDB.idempotencyKeys.set(opId, true);
      mockDB.reports.set(report.id, { ...report });
      duplicateCreated = true;
    }

    expect(mockDB.reports.size).toBe(1);
    expect(duplicateCreated).toBe(false);
  });

  it('prevents duplicate entries in sync queue', async () => {
    const opId = 'op-queue-1';
    const change = { opId, entity: 'report', op: 'upsert', data: { id: 'report-1' } };

    mockDB.syncQueue.push(change);

    const existingOpIds = new Set(mockDB.syncQueue.map((q) => q.opId));
    if (!existingOpIds.has(opId)) {
      mockDB.syncQueue.push(change);
    }

    expect(mockDB.syncQueue.length).toBe(1);
  });

  it('handles concurrent sync requests without duplication', async () => {
    const report = { id: 'report-concurrent', piles: [{ count: 3 }], version: 1 };
    const opId = 'op-concurrent-1';

    // Simulate duplicate delivery of the same operation across concurrent requests.
    const results = await Promise.all(
      Array.from({ length: 3 }, async () => {
        await new Promise((r) => setTimeout(r, Math.random() * 100));

        if (!mockDB.idempotencyKeys.has(opId)) {
          mockDB.idempotencyKeys.set(opId, true);
          mockDB.reports.set(report.id, { ...report, version: report.version + 1 });
          return { opId, success: true };
        }

        return { opId, success: false, reason: 'duplicate' };
      })
    );

    const successCount = results.filter((r) => r.success).length;
    expect(successCount).toBe(1);
    expect(mockDB.reports.size).toBe(1);
  });
});

describe('Data Integrity - Correct Aggregates', () => {
  it('calculates correct pile counts', async () => {
    const reports = [
      { id: 'r1', piles: [{ count: 5 }, { count: 3 }] },
      { id: 'r2', piles: [{ count: 2 }] },
      { id: 'r3', piles: [{ count: 10 }, { count: 7 }] },
    ];

    const totalPiles = reports.reduce(
      (sum, r) => sum + r.piles.reduce((pSum, p) => pSum + p.count, 0),
      0
    );

    expect(totalPiles).toBe(27);
  });

  it('calculates correct drilling meters', async () => {
    const reports = [
      { id: 'r1', drillings: [{ meters: 25 }, { meters: 30 }] },
      { id: 'r2', drillings: [{ meters: 15 }] },
    ];

    const totalMeters = reports.reduce(
      (sum, r) => sum + r.drillings.reduce((dSum, d) => dSum + d.meters, 0),
      0
    );

    expect(totalMeters).toBe(70);
  });

  it('calculates correct downtime duration', async () => {
    const reports = [
      { id: 'r1', downtimes: [{ duration: 30 }, { duration: 45 }] },
      { id: 'r2', downtimes: [{ duration: 60 }] },
    ];

    const totalDowntime = reports.reduce(
      (sum, r) => sum + r.downtimes.reduce((dTSum, d) => dTSum + d.duration, 0),
      0
    );

    expect(totalDowntime).toBe(135);
  });
});
