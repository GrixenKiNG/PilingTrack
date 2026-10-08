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
  mockSiteFindMany: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/db', () => ({
  db: {
    report: {
      findUnique: mocks.mockReportFindUnique,
      findMany: mocks.mockReportFindMany,
    },
    site: { findUnique: mocks.mockSiteFindUnique, findMany: mocks.mockSiteFindMany },
    tenant: { findMany: vi.fn().mockResolvedValue([{ id: 'tenant-1' }]) },
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
    it('W121: skips overlapping weekly passes and resumes after the pending pass', async () => {
      const { startProjectionWorker } = await import('@/modules/reports/application/projections/projection-worker');
      mocks.mockOutboxFindMany.mockResolvedValue([]);
      let release!: (sites: { id: string }[]) => void;
      mocks.mockSiteFindMany.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
      const intervals = vi.spyOn(globalThis, 'setInterval');
      const worker = startProjectionWorker(14_400_000);
      const runWeekly = intervals.mock.calls.find(([, delay]) => delay === 3_600_000)?.[0] as () => Promise<void>;
      try {
        const pending = runWeekly();
        await vi.advanceTimersByTimeAsync(0);
        await runWeekly();
        expect(mocks.mockSiteFindMany).toHaveBeenCalledTimes(1);
        release([]);
        await pending;
        await runWeekly();
        expect(mocks.mockSiteFindMany).toHaveBeenCalledTimes(2);
      } finally { release([]); worker.stop(); intervals.mockRestore(); }
    });

    it('W121: stop prevents the pending weekly pass from starting the next site', async () => {
      const { startProjectionWorker } = await import('@/modules/reports/application/projections/projection-worker');
      mocks.mockOutboxFindMany.mockResolvedValue([]);
      mocks.mockSiteFindMany.mockResolvedValueOnce([{ id: 'site-1' }, { id: 'site-2' }]);
      let release!: () => void;
      mocks.mockWeeklyUpsert.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
      const intervals = vi.spyOn(globalThis, 'setInterval');
      const worker = startProjectionWorker(14_400_000);
      const runWeekly = intervals.mock.calls.find(([, delay]) => delay === 3_600_000)?.[0] as () => Promise<void>;
      try {
        const pending = runWeekly();
        await vi.advanceTimersByTimeAsync(0);
        expect(mocks.mockWeeklyUpsert).toHaveBeenCalledTimes(1);
        worker.stop();
        release();
        await pending;
        expect(mocks.mockWeeklyUpsert).toHaveBeenCalledTimes(1);
        await runWeekly();
        expect(mocks.mockSiteFindMany).toHaveBeenCalledTimes(1);
      } finally { release(); worker.stop(); intervals.mockRestore(); }
    });

    it.each(['SIGTERM', 'SIGINT'] as const)('W121: %s and repeated stop release only this worker\'s listeners', async signal => {
      const { startProjectionWorker } = await import('@/modules/reports/application/projections/projection-worker');
      mocks.mockOutboxFindMany.mockResolvedValue([]);
      const before = { SIGTERM: process.listeners('SIGTERM'), SIGINT: process.listeners('SIGINT') };
      const worker = startProjectionWorker();
      const added = {
        SIGTERM: process.listeners('SIGTERM').filter(listener => !before.SIGTERM.includes(listener)),
        SIGINT: process.listeners('SIGINT').filter(listener => !before.SIGINT.includes(listener)),
      };
      try {
        expect(added[signal]).toHaveLength(1);
        added[signal][0]();
        worker.stop(); worker.stop();
        expect(process.listeners('SIGTERM')).toEqual(before.SIGTERM);
        expect(process.listeners('SIGINT')).toEqual(before.SIGINT);
      } finally {
        worker.stop();
        for (const name of ['SIGTERM', 'SIGINT'] as const) {
          for (const listener of added[name]) process.removeListener(name, listener);
        }
      }
    });

    it('hourly recomputation skips a site deleted after listing and updates the next site', async () => {
      const { startProjectionWorker } = await import('@/modules/reports/application/projections/projection-worker');
      mocks.mockOutboxFindMany.mockResolvedValue([]);
      mocks.mockSiteFindMany.mockResolvedValueOnce([{ id: 'site-deleted' }, { id: 'site-live' }]);
      mocks.mockSiteFindUnique.mockResolvedValueOnce(null).mockResolvedValue({ tenantId: 'tenant-1' });
      const worker = startProjectionWorker(7_200_000);
      try {
        await vi.advanceTimersByTimeAsync(3_600_000);
        expect(mocks.mockWeeklyUpsert).toHaveBeenCalledWith(expect.objectContaining({
          create: expect.objectContaining({ siteId: 'site-live', tenantId: 'tenant-1' }),
        }));
      } finally { worker.stop(); }
    });
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
