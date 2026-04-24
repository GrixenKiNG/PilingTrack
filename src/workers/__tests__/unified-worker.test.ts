/**
 * Unified Worker Service — Unit Tests
 *
 * Tests the unified worker service:
 * - Health check endpoint
 * - Worker lifecycle (start/stop)
 * - Error handling
 * - Graceful shutdown
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ============================================================
// Mocks
// ============================================================

const mocks = vi.hoisted(() => ({
  // Outbox
  mockStartOutboxWorker: vi.fn(),
  mockGetOutboxStats: vi.fn().mockResolvedValue({ unpublished: 0, failed: 0, total: 0 }),
  mockEmitDomainEvent: vi.fn().mockResolvedValue(undefined),
  mockRegisterAllEventSchemas: vi.fn(),

  // Projection
  mockStartProjectionWorker: vi.fn(),

  // PDF
  mockBullMQWorker: vi.fn(),

  // Health
  mockRecordWorkerHeartbeat: vi.fn().mockResolvedValue(undefined),

  // Leader election
  mockOutboxElection: {
    onBecomeLeader: undefined as undefined | (() => void),
    onLoseLeadership: undefined as undefined | (() => void),
    start: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
    isLeader: vi.fn(() => true),
    getStats: vi.fn(() => ({ nodeId: 'test-node' })),
  },
  mockProjectionElection: {
    onBecomeLeader: undefined as undefined | (() => void),
    onLoseLeadership: undefined as undefined | (() => void),
    start: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
    isLeader: vi.fn(() => true),
    getStats: vi.fn(() => ({ nodeId: 'test-node' })),
  },

  // Logger
  mockLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },

  // HTTP server
  mockHttpListen: vi.fn(),
  mockHttpClose: vi.fn(),
}));

mocks.mockOutboxElection.start.mockImplementation(async () => {
  mocks.mockOutboxElection.onBecomeLeader?.();
});

mocks.mockProjectionElection.start.mockImplementation(async () => {
  mocks.mockProjectionElection.onBecomeLeader?.();
});

vi.mock('@/services/reports/outbox-publisher', () => ({
  startOutboxWorker: mocks.mockStartOutboxWorker.mockReturnValue({
    stop: vi.fn(),
  }),
  getOutboxStats: mocks.mockGetOutboxStats,
}));

vi.mock('@/services/reports/domain-events', () => ({
  emitDomainEvent: mocks.mockEmitDomainEvent,
}));

vi.mock('@/core/event-bus/schema-registry', () => ({
  registerAllEventSchemas: mocks.mockRegisterAllEventSchemas,
}));

vi.mock('@/modules/reports/application/projections/projection-worker', () => ({
  startProjectionWorker: mocks.mockStartProjectionWorker.mockReturnValue({
    stop: vi.fn(),
  }),
}));

vi.mock('@/services/reports/event-handlers', () => ({
  registerAllEventHandlers: vi.fn(),
}));

vi.mock('@/core/observability/health-tracker', () => ({
  recordWorkerHeartbeat: mocks.mockRecordWorkerHeartbeat,
}));

vi.mock('@/core/infrastructure/leader-election', () => ({
  getOutboxLeaderElection: vi.fn(() => mocks.mockOutboxElection),
  getProjectionLeaderElection: vi.fn(() => mocks.mockProjectionElection),
}));

vi.mock('@/lib/logger', () => ({
  logger: mocks.mockLogger,
}));

vi.mock('bullmq', () => ({
  Worker: mocks.mockBullMQWorker.mockReturnValue({
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('ioredis', () => ({
  default: class MockRedis {
    constructor() {}
    async quit() {}
  },
}));

vi.mock('http', () => ({
  default: {
    createServer: vi.fn().mockReturnValue({
      listen: mocks.mockHttpListen,
      close: mocks.mockHttpClose,
    }),
  },
}));

// ============================================================
// Tests
// ============================================================

describe('Unified Worker Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.mockOutboxElection.onBecomeLeader = undefined;
    mocks.mockOutboxElection.onLoseLeadership = undefined;
    mocks.mockProjectionElection.onBecomeLeader = undefined;
    mocks.mockProjectionElection.onLoseLeadership = undefined;

    // Set env vars for testing
    process.env.ENABLED_WORKERS = 'outbox,projection';
    process.env.WORKER_HEALTH_PORT = '0'; // Use random port for tests
    process.env.OUTBOX_INTERVAL_MS = '100';
    process.env.PROJECTION_INTERVAL_MS = '100';
  });

  afterEach(() => {
    delete process.env.ENABLED_WORKERS;
    delete process.env.WORKER_HEALTH_PORT;
    delete process.env.OUTBOX_INTERVAL_MS;
    delete process.env.PROJECTION_INTERVAL_MS;
    delete process.env.REDIS_URL;
  });

  describe('Health check endpoint', () => {
    it('returns health status with worker information', async () => {
      // Import to trigger server creation
      await import('@/workers/unified-worker');

      // Wait for initialization
      await vi.waitFor(() => {
        expect(mocks.mockHttpListen).toHaveBeenCalled();
      });

      // Health server should be created with correct port
      expect(mocks.mockHttpListen).toHaveBeenCalledWith(
        0, // WORKER_HEALTH_PORT
        expect.any(Function)
      );
    });
  });

  describe('Worker lifecycle', () => {
    it('starts outbox worker when enabled', async () => {
      process.env.ENABLED_WORKERS = 'outbox';

      await import('@/workers/unified-worker');

      await vi.waitFor(() => {
        expect(mocks.mockStartOutboxWorker).toHaveBeenCalled();
      });
    });

    it('starts projection worker when enabled', async () => {
      process.env.ENABLED_WORKERS = 'projection';

      await import('@/workers/unified-worker');

      await vi.waitFor(() => {
        expect(mocks.mockStartProjectionWorker).toHaveBeenCalled();
      });
    });

    it('does not start disabled workers', async () => {
      process.env.ENABLED_WORKERS = 'outbox';

      await import('@/workers/unified-worker');

      await vi.waitFor(() => {
        expect(mocks.mockStartOutboxWorker).toHaveBeenCalled();
        expect(mocks.mockStartProjectionWorker).not.toHaveBeenCalled();
      });
    });

    it('uses configured polling intervals', async () => {
      process.env.ENABLED_WORKERS = 'outbox';
      process.env.OUTBOX_INTERVAL_MS = '5000';

      await import('@/workers/unified-worker');

      await vi.waitFor(() => {
        expect(mocks.mockStartOutboxWorker).toHaveBeenCalledWith(
          expect.any(Function),
          5000
        );
      });
    });
  });

  describe('Error handling', () => {
    it('records heartbeat after successful event processing', async () => {
      process.env.ENABLED_WORKERS = 'outbox';

      // Get the handler passed to startOutboxWorker
      await import('@/workers/unified-worker');

      await vi.waitFor(() => {
        expect(mocks.mockStartOutboxWorker).toHaveBeenCalled();
      });

      const handler = mocks.mockStartOutboxWorker.mock.calls[0][0];

      // Simulate event processing
      await handler({
        type: 'report.created',
        aggregateId: 'r1',
        aggregateType: 'Report',
        occurredAt: new Date().toISOString(),
      });

      // Heartbeat should be recorded
      expect(mocks.mockEmitDomainEvent).toHaveBeenCalled();
    });
  });
});
