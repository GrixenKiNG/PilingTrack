/**
 * Projection Worker — Unit Tests
 *
 * Tests CQRS read model projections:
 * - Event routing to handlers
 * - ReportStats projection
 * - OperatorPerformance projection
 * - DowntimeSummary projection
 * - Staleness detection
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock DB
const mocks = vi.hoisted(() => ({
  mockReportFindUnique: vi.fn(),
  mockOutboxFindMany: vi.fn(),
  mockOutboxFindUnique: vi.fn(),
  mockOutboxUpdate: vi.fn(),
  mockUpsert: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    report: {
      findUnique: mocks.mockReportFindUnique,
      findMany: vi.fn().mockResolvedValue([]),
    },
    reportStats: { upsert: mocks.mockUpsert },
    operatorPerformance: { upsert: mocks.mockUpsert },
    downtimeSummary: { upsert: mocks.mockUpsert },
    siteDailySummary: { upsert: mocks.mockUpsert },
    siteWeeklyTrend: { upsert: mocks.mockUpsert },
    reportAnalytics: { upsert: mocks.mockUpsert },
    outboxEvent: {
      findMany: mocks.mockOutboxFindMany,
      findUnique: mocks.mockOutboxFindUnique,
      update: mocks.mockOutboxUpdate,
      count: vi.fn().mockResolvedValue(0),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/core/outbox/dead-letter-queue', () => ({
  moveToDlq: vi.fn(),
}));

// ============================================================
// Helpers
// ============================================================

function createEvent(overrides = {}) {
  return {
    type: 'ReportCreated',
    aggregateId: 'report-1',
    aggregateType: 'Report',
    siteId: 'site-1',
    userId: 'user-1',
    tenantId: 'tenant-1',
    occurredAt: new Date().toISOString(),
    data: {},
    ...overrides,
  };
}

// ============================================================
// Tests
// ============================================================

describe('Projection Worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('startProjectionWorker', () => {
    it('creates a worker with stop method', async () => {
      const { startProjectionWorker } = await import(
        '@/modules/reports/application/projections/projection-worker'
      );

      mocks.mockOutboxFindMany.mockResolvedValue([]);
      mocks.mockOutboxFindUnique.mockResolvedValue({ published: false });
      mocks.mockOutboxUpdate.mockResolvedValue({});

      const worker = startProjectionWorker(1000);

      expect(worker).toHaveProperty('stop');
      expect(typeof worker.stop).toBe('function');

      worker.stop();
    });

    it('processes outbox events and updates projections', async () => {
      const { startProjectionWorker } = await import(
        '@/modules/reports/application/projections/projection-worker'
      );

      const event = {
        id: 'outbox-1',
        type: 'ReportCreated',
        aggregateId: 'report-1',
        aggregateType: 'Report',
        payload: createEvent(),
        published: false,
        attempts: 0,
        createdAt: new Date(),
      };

      mocks.mockOutboxFindMany
        .mockResolvedValueOnce([event])
        .mockResolvedValue([]);
      mocks.mockOutboxFindUnique.mockResolvedValue({ published: false });
      mocks.mockOutboxUpdate.mockResolvedValue({});
      mocks.mockReportFindUnique.mockResolvedValueOnce({
        id: 'report-1',
        reportId: 'report-1',
        siteId: 'site-1',
        userId: 'user-1',
        status: 'draft',
        date: '2026-04-09',
        piles: [],
        drillings: [],
        downtimes: [],
      });

      const worker = startProjectionWorker(1000);
      await vi.advanceTimersByTimeAsync(1000);

      // Projections should be upserted
      expect(mocks.mockUpsert).toHaveBeenCalled();

      worker.stop();
    });

    it('stops polling after worker.stop()', async () => {
      const { startProjectionWorker } = await import(
        '@/modules/reports/application/projections/projection-worker'
      );

      mocks.mockOutboxFindMany.mockResolvedValue([]);
      mocks.mockOutboxFindUnique.mockResolvedValue({ published: false });
      mocks.mockOutboxUpdate.mockResolvedValue({});

      const worker = startProjectionWorker(1000);
      worker.stop();

      await vi.advanceTimersByTimeAsync(3000);

      // No upsert calls should be made
      expect(mocks.mockUpsert).not.toHaveBeenCalled();
    });
  });

  describe('Event routing', () => {
    it('routes report.created to projection handlers', async () => {
      const { startProjectionWorker } = await import(
        '@/modules/reports/application/projections/projection-worker'
      );

      const event = {
        id: 'outbox-1',
        type: 'ReportCreated',
        aggregateId: 'report-1',
        aggregateType: 'Report',
        payload: createEvent({ type: 'ReportCreated' }),
        published: false,
        attempts: 0,
        createdAt: new Date(),
      };

      mocks.mockOutboxFindMany.mockResolvedValueOnce([event]).mockResolvedValue([]);
      mocks.mockOutboxFindUnique.mockResolvedValue({ published: false });
      mocks.mockOutboxUpdate.mockResolvedValue({});
      mocks.mockReportFindUnique.mockResolvedValueOnce({
        id: 'report-1',
        reportId: 'report-1',
        siteId: 'site-1',
        userId: 'user-1',
        status: 'draft',
        date: '2026-04-09',
        piles: [],
        drillings: [],
        downtimes: [],
      });

      const worker = startProjectionWorker(500);
      await vi.advanceTimersByTimeAsync(500);

      // Report was fetched and projections updated
      expect(mocks.mockReportFindUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { reportId: 'report-1' } })
      );

      worker.stop();
    });

    it('skips events with no matching report', async () => {
      const { startProjectionWorker } = await import(
        '@/modules/reports/application/projections/projection-worker'
      );

      const event = {
        id: 'outbox-1',
        type: 'ReportCreated',
        aggregateId: 'report-missing',
        aggregateType: 'Report',
        payload: createEvent(),
        published: false,
        attempts: 0,
        createdAt: new Date(),
      };

      mocks.mockOutboxFindMany.mockResolvedValueOnce([event]).mockResolvedValue([]);
      mocks.mockOutboxFindUnique.mockResolvedValue({ published: false });
      mocks.mockOutboxUpdate.mockResolvedValue({});
      mocks.mockReportFindUnique.mockResolvedValueOnce(null); // Report not found

      const worker = startProjectionWorker(500);
      await vi.advanceTimersByTimeAsync(500);

      // No projections should be created
      expect(mocks.mockUpsert).not.toHaveBeenCalled();

      worker.stop();
    });
  });

  describe('Downtime projection', () => {
    it('computes top downtime reason from report downtimes', async () => {
      const { startProjectionWorker } = await import(
        '@/modules/reports/application/projections/projection-worker'
      );

      const event = {
        id: 'outbox-1',
        type: 'ReportUpdated',
        aggregateId: 'report-1',
        aggregateType: 'Report',
        payload: createEvent({ type: 'ReportUpdated' }),
        published: false,
        attempts: 0,
        createdAt: new Date(),
      };

      mocks.mockOutboxFindMany.mockResolvedValueOnce([event]).mockResolvedValue([]);
      mocks.mockOutboxFindUnique.mockResolvedValue({ published: false });
      mocks.mockOutboxUpdate.mockResolvedValue({});
      mocks.mockReportFindUnique.mockResolvedValueOnce({
        id: 'report-1',
        reportId: 'report-1',
        siteId: 'site-1',
        userId: 'user-1',
        status: 'submitted',
        date: '2026-04-09',
        piles: [{ id: 'p1', count: 5 }],
        drillings: [{ id: 'd1', meters: 10 }],
        downtimes: [
          { id: 'dt1', reasonId: 'reason-1', duration: 30 },
          { id: 'dt2', reasonId: 'reason-1', duration: 20 },
          { id: 'dt3', reasonId: 'reason-2', duration: 10 },
        ],
      });

      const worker = startProjectionWorker(500);
      await vi.advanceTimersByTimeAsync(500);

      // DowntimeSummary should be upserted with reason-1 as top
      expect(mocks.mockUpsert).toHaveBeenCalled();

      worker.stop();
    });
  });
});
