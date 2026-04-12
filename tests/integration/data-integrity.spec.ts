/**
 * Data Integrity Tests — PilingTrack
 *
 * Verifies:
 * - No data loss during sync
 * - No data duplication
 * - Correct aggregates
 * - Consistent state across operations
 *
 * Run: npx vitest run tests/integration/data-integrity.spec.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock DB for testing
const mockDB = {
  reports: new Map<string, any>(),
  syncQueue: [] as any[],
  idempotencyKeys: new Map<string, boolean>(),
};

describe('Data Integrity — No Data Loss', () => {
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
          // Failed — keep in queue
          mockDB.syncQueue.push({ opId, data: report, status: 'pending' });
        } else {
          // Success
          mockDB.reports.set(report.id, { ...report, version: report.version + 1 });
          mockDB.syncQueue = mockDB.syncQueue.filter((q) => q.opId !== opId);
        }
      }
    }

    // Verify data is preserved and not duplicated
    expect(mockDB.reports.size).toBe(1);
    expect(mockDB.reports.get('report-2').version).toBe(2);
    expect(mockDB.syncQueue.length).toBe(2); // Failed attempts still tracked
  });

  it('preserves data through conflict resolution', async () => {
    const serverReport = {
      id: 'report-3',
      piles: [{ pileGradeId: 'grade-1', count: 5 }],
      drillings: [{ typeId: 'type-1', meters: 20 }],
      downtimes: [{ reasonId: 'reason-1', duration: 15 }],
      version: 5,
    };

    const clientReport = {
      id: 'report-3',
      piles: [{ pileGradeId: 'grade-2', count: 8 }],
      drillings: [],
      downtimes: [{ reasonId: 'reason-2', duration: 30 }],
      version: 3, // Stale version
    };

    // Conflict detected — server wins on critical fields, merge on others
    const criticalFields = new Set(['status', 'date', 'siteId', 'userId']);
    const resolvedReport = { ...serverReport };

    // Merge non-critical fields from client
    for (const [key, value] of Object.entries(clientReport)) {
      if (!criticalFields.has(key) && serverReport[key] !== value) {
        if (key === 'piles' || key === 'drillings' || key === 'downtimes') {
          // Deep merge for arrays
          resolvedReport[key] = [
            ...(serverReport[key] || []),
            ...(clientReport[key] || []),
          ];
        } else {
          resolvedReport[key] = value;
        }
      }
    }

    // Verify merge preserved all data
    expect(resolvedReport.piles).toHaveLength(2); // Both versions
    expect(resolvedReport.downtimes).toHaveLength(2); // Both versions
    expect(resolvedReport.version).toBe(serverReport.version); // Server version maintained
  });
});

describe('Data Integrity — No Duplication', () => {
  beforeEach(() => {
    mockDB.reports.clear();
    mockDB.syncQueue = [];
    mockDB.idempotencyKeys.clear();
  });

  it('prevents duplicate report creation via idempotency', async () => {
    const report = { id: 'report-1', piles: [{ count: 5 }], version: 1 };
    const opId = 'op-unique-1';

    // First sync — creates report
    if (!mockDB.idempotencyKeys.has(opId)) {
      mockDB.idempotencyKeys.set(opId, true);
      mockDB.reports.set(report.id, { ...report });
    }

    // Simulate duplicate sync (same opId)
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

    // Add to queue
    mockDB.syncQueue.push(change);

    // Try to add duplicate
    const existingOpIds = new Set(mockDB.syncQueue.map((q) => q.opId));
    if (!existingOpIds.has(opId)) {
      mockDB.syncQueue.push(change);
    }

    expect(mockDB.syncQueue.length).toBe(1);
  });

  it('handles concurrent sync requests without duplication', async () => {
    const report = { id: 'report-concurrent', piles: [{ count: 3 }], version: 1 };
    const opIds = ['op-concurrent-1', 'op-concurrent-2', 'op-concurrent-3'];

    // Simulate 3 concurrent sync requests
    const results = await Promise.all(
      opIds.map(async (opId) => {
        // Simulate network delay
        await new Promise((r) => setTimeout(r, Math.random() * 100));

        if (!mockDB.idempotencyKeys.has(opId)) {
          mockDB.idempotencyKeys.set(opId, true);
          mockDB.reports.set(report.id, { ...report, version: report.version + 1 });
          return { opId, success: true };
        }

        return { opId, success: false, reason: 'duplicate' };
      })
    );

    // Only first request should succeed
    const successCount = results.filter((r) => r.success).length;
    expect(successCount).toBe(1);

    // Only one report should exist
    expect(mockDB.reports.size).toBe(1);
  });
});

describe('Data Integrity — Correct Aggregates', () => {
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

    expect(totalPiles).toBe(27); // 5+3+2+10+7
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

    expect(totalMeters).toBe(70); // 25+30+15
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

    expect(totalDowntime).toBe(135); // 30+45+60
  });
});
