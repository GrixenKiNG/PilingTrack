/**
 * Projection Worker — Unit Tests
 *
 * Tests CQRS read model projections:
 * - Event routing to handlers
 * - SiteWeeklyTrend projection (единственная, что живёт на событийном пути)
 * - Staleness detection
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock DB
const mocks = vi.hoisted(() => ({
  mockReportFindUnique: vi.fn(),
  mockReportFindMany: vi.fn().mockResolvedValue([]),
  mockOutboxFindMany: vi.fn(),
  mockOutboxFindUnique: vi.fn(),
  mockOutboxUpdate: vi.fn(),
  mockUpsert: vi.fn(),
  mockWeeklyUpsert: vi.fn(),
  mockSiteFindUnique: vi.fn().mockResolvedValue({ tenantId: 'tenant-1' }),
  mockDailyFindMany: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/db', () => ({
  db: {
    report: {
      findUnique: mocks.mockReportFindUnique,
      findMany: mocks.mockReportFindMany,
    },
    site: { findUnique: mocks.mockSiteFindUnique },
    siteDailySummary: { upsert: mocks.mockUpsert, findMany: mocks.mockDailyFindMany },
    siteWeeklyTrend: { upsert: mocks.mockWeeklyUpsert },
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
        occurredAt: new Date(),
        createdAt: new Date(),
      };

      mocks.mockOutboxFindMany
        .mockResolvedValueOnce([event])
        .mockResolvedValue([]);
      mocks.mockOutboxFindUnique.mockResolvedValue({ published: false });
      mocks.mockOutboxUpdate.mockResolvedValue({});
      mocks.mockReportFindUnique.mockResolvedValue({
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

      // После 17.08.2026 живая проекция на этом пути одна — недельный тренд.
      // Раньше здесь проверялся общий mockUpsert, за которым стояли ещё
      // ReportStats, OperatorPerformance и DowntimeSummary; их удалили вместе
      // с обработчиками, потому что читателей у них не было.
      expect(mocks.mockWeeklyUpsert).toHaveBeenCalled();

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
        occurredAt: new Date(),
        createdAt: new Date(),
      };

      mocks.mockOutboxFindMany.mockResolvedValueOnce([event]).mockResolvedValue([]);
      mocks.mockOutboxFindUnique.mockResolvedValue({ published: false });
      mocks.mockOutboxUpdate.mockResolvedValue({});
      mocks.mockReportFindUnique.mockResolvedValue({
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

    it('sets tenantId on the weekly trend upsert (NOT NULL in DB)', async () => {
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
        occurredAt: new Date(),
        createdAt: new Date(),
      };

      mocks.mockOutboxFindMany.mockResolvedValueOnce([event]).mockResolvedValue([]);
      mocks.mockOutboxFindUnique.mockResolvedValue({ published: false });
      mocks.mockOutboxUpdate.mockResolvedValue({});
      mocks.mockSiteFindUnique.mockResolvedValue({ tenantId: 'tenant-1' });
      mocks.mockDailyFindMany.mockResolvedValue([]);
      mocks.mockReportFindUnique.mockResolvedValue({
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

      expect(mocks.mockWeeklyUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ tenantId: 'tenant-1' }),
        })
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
        occurredAt: new Date(),
        createdAt: new Date(),
      };

      mocks.mockOutboxFindMany.mockResolvedValueOnce([event]).mockResolvedValue([]);
      mocks.mockOutboxFindUnique.mockResolvedValue({ published: false });
      mocks.mockOutboxUpdate.mockResolvedValue({});
      mocks.mockReportFindUnique.mockResolvedValue(null); // Report not found

      const worker = startProjectionWorker(500);
      await vi.advanceTimersByTimeAsync(500);

      // No projections should be created
      expect(mocks.mockUpsert).not.toHaveBeenCalled();

      worker.stop();
    });
  });

  // Блоки «OperatorPerformance projection» и «Downtime projection» удалены
  // 17.08.2026 вместе с самими проекциями: они проверяли поведение, которого
  // больше нет. Их предмет — агрегация по рабочей дате отчёта и вычисление
  // главной причины простоя — сохранён в истории git на случай, если экран
  // производительности когда-нибудь понадобится.
});
