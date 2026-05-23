import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================
// Fake IndexedDB
// ============================================================

import 'fake-indexeddb/auto';

// ============================================================
// vi.hoisted — runs BEFORE vi.mock hoisting, so factory can reference these
// ============================================================

const mocks = vi.hoisted(() => ({
  getPendingItems: vi.fn().mockResolvedValue([]),
  markSyncing: vi.fn().mockResolvedValue(undefined),
  markSynced: vi.fn().mockResolvedValue(undefined),
  markFailed: vi.fn().mockResolvedValue(undefined),
  resetFailedForRetry: vi.fn().mockResolvedValue(undefined),
  getLastPullSync: vi.fn().mockResolvedValue(0),
  setLastPullSync: vi.fn().mockResolvedValue(undefined),
  getSyncStatus: vi.fn().mockResolvedValue({ pending: 0, failed: 0 }),
}));

// ============================================================
// Mock fetch
// ============================================================

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ============================================================
// Mock Dexie DB (getDB) — mockDb defined INSIDE vi.mock factory
// ============================================================

vi.mock('../../db/schema', () => {
  const mockDb = {
    reports: {
      get: vi.fn().mockResolvedValue(undefined),
      put: vi.fn().mockResolvedValue(undefined),
      bulkPut: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(undefined),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockResolvedValue([]),
        toArray: vi.fn().mockResolvedValue([]),
      }),
    },
    pileWork: {
      bulkPut: vi.fn().mockResolvedValue([]),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockResolvedValue(0),
      }),
    },
    drillings: {
      bulkPut: vi.fn().mockResolvedValue([]),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockResolvedValue(0),
      }),
    },
    downtimes: {
      bulkPut: vi.fn().mockResolvedValue([]),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockResolvedValue(0),
      }),
    },
    outbox: {
      where: vi.fn().mockImplementation(() => ({
        equals: vi.fn().mockImplementation(() => ({
          limit: vi.fn().mockImplementation(() => ({
            sortBy: vi.fn().mockResolvedValue([]),
          })),
        })),
      })),
      toArray: vi.fn().mockResolvedValue([]),
    },
    syncMeta: {
      get: vi.fn().mockResolvedValue(undefined),
      put: vi.fn().mockResolvedValue(undefined),
    },
  };
  return {
    getDB: () => mockDb,
    LocalReport: undefined,
    OutboxEntry: undefined,
  };
});

// ============================================================
// Mock outbox-service
// ============================================================

vi.mock('../outbox/outbox-service', () => ({
  outboxService: mocks,
}));

// ============================================================
// Mock vector-clock-manager (no-op for unit tests)
// ============================================================

vi.mock('../vector-clock-manager', () => ({
  attachVCToOutboxEntry: vi.fn().mockResolvedValue({}),
  applyServerVCToReport: vi.fn().mockResolvedValue(undefined),
}));

// ============================================================
// Import after mocking
// ============================================================

import {
  serializeOutboxItem,
  calculateRetryDelay,
  runSyncCycle,
  manualSync,
  startAutoSync,
  stopAutoSync,
  getSyncStatusUI,
} from '../sync-engine';

import type { OutboxEntry } from '../../db/schema';

// ============================================================
// Helper
// ============================================================

function makeOutboxItem(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id: 1,
    type: 'REPORT_CREATE',
    entity: 'report',
    entityId: 'report-123',
    payload: { date: '2026-04-07', shiftType: 'DAY' },
    status: 'pending',
    attempts: 0,
    lastError: null,
    createdAt: Date.now(),
    ...overrides,
  };
}

// ============================================================
// Tests — serializeOutboxItem (pure function)
// ============================================================

describe('serializeOutboxItem', () => {
  it('should serialize outbox item with correct structure', () => {
    const item = makeOutboxItem({ id: 42, createdAt: 1000 });
    const result = serializeOutboxItem(item);

    expect(result.id).toBe('op_42_1000');
    expect(result.type).toBe('REPORT_CREATE');
    expect(result.entity).toBe('report');
    expect(result.entityId).toBe('report-123');
    expect(result.payload).toEqual({ date: '2026-04-07', shiftType: 'DAY' });
    expect(result.localTimestamp).toBe(1000);
  });
});

// ============================================================
// Tests — calculateRetryDelay (pure function)
// ============================================================

describe('calculateRetryDelay', () => {
  it('should return increasing delays for attempt 0, 1, 2', () => {
    // Test multiple times to account for jitter
    for (let i = 0; i < 20; i++) {
      const d0 = calculateRetryDelay(0);
      const d1 = calculateRetryDelay(1);
      const d2 = calculateRetryDelay(2);

      // attempt 0: baseDelayMs * 2^0 = 1000, jitter +/- 25% => [750, 1250]
      expect(d0).toBeGreaterThanOrEqual(750);
      expect(d0).toBeLessThanOrEqual(1250);

      // attempt 1: 2000, +/- 25% => [1500, 2500]
      expect(d1).toBeGreaterThanOrEqual(1500);
      expect(d1).toBeLessThanOrEqual(2500);

      // attempt 2: 4000, +/- 25% => [3000, 5000]
      expect(d2).toBeGreaterThanOrEqual(3000);
      expect(d2).toBeLessThanOrEqual(5000);

      // Exponential: each should be roughly 2x previous
      expect(d1).toBeGreaterThan(d0);
      expect(d2).toBeGreaterThan(d1);
    }
  });

  it('should cap delay at maxDelayMs', () => {
    // attempt 10: 1000 * 2^10 = 1024000, capped at 30000
    for (let i = 0; i < 10; i++) {
      const d = calculateRetryDelay(10);
      expect(d).toBeLessThanOrEqual(30000);
    }
  });
});

// ============================================================
// Tests — pullUpdates (via runSyncCycle)
// ============================================================

describe('pullUpdates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPendingItems.mockResolvedValue([]); // No push, only pull
  });

  it('should silently skip pull on 401 response', async () => {
    mockFetch.mockResolvedValue({
      status: 401,
      ok: false,
    });

    const result = await runSyncCycle();

    expect(result.pulled).toBe(0);
    expect(result.pushed).toBe(0);
  });

  it.skip('should apply server reports from successful pull', async () => {
    // Skipped: Dexie/IndexedDB mock complexity. Sync v3 is consciously
    // deferred per audit N-2 (see docs/audit.md); re-enable when the
    // sync engine is reactivated alongside a proper Dexie test harness.
    const serverReports = [
      {
        reportId: 'srv-report-1',
        tenantId: 'tenant-1',
        siteId: 'site-1',
        site: { name: 'Site Alpha' },
        userId: 'user-1',
        user: { name: 'Ivanov I.I.' },
        date: '2026-04-07',
        shiftType: 'DAY',
        shiftStart: '08:00',
        shiftEnd: '20:00',
        equipmentId: null,
        status: 'submitted',
        version: 3,
        createdAt: '2026-04-07T08:00:00Z',
        updatedAt: '2026-04-07T10:00:00Z',
        piles: [
          {
            id: 'pile-1',
            picketId: null,
            pileGradeId: 'pg-1',
            pileGrade: { name: 'M100' },
            count: 5,
          },
        ],
        drillings: [],
        downtimes: [],
      },
    ];

    mocks.getLastPullSync.mockResolvedValue(1000);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          reports: serverReports,
          events: [],
          cursor: 2000,
        }),
    });

    const result = await runSyncCycle();

    expect(result.pulled).toBe(1);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/sync/updates'),
      expect.any(Object)
    );
    expect(mocks.setLastPullSync).toHaveBeenCalledWith(2000);
  });
});

// ============================================================
// Tests — runSyncCycle
// ============================================================

describe('runSyncCycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.skip('should push then pull in sequence', async () => {
    // Skipped: Dexie mock complexity — see audit N-2 (sync v3 deferred).
    const item = makeOutboxItem({ id: 100 });
    mocks.getPendingItems.mockResolvedValue([item]);
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ reports: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ reports: [], events: [], cursor: 500 }),
      });

    const result = await runSyncCycle();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/sync');
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
    expect(mockFetch.mock.calls[1][0]).toContain('/api/sync/updates');
    expect(result.pushed).toBe(1);
    expect(result.pulled).toBe(0);
    expect(result.failed).toBe(0);
    expect(mocks.markSynced).toHaveBeenCalledWith(100);
  });

  // Skipped: sync v3 is intentionally disabled in sync-engine.ts (pushOutbox
  // and pullUpdates return early without hitting the network). Re-enable the
  // test together with the early returns in sync-engine.ts.
  it.skip('should skip pull when no pending outbox items', async () => {
    mocks.getPendingItems.mockResolvedValue([]);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ reports: [], events: [], cursor: 100 }),
    });

    const result = await runSyncCycle();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain('/api/sync/updates');
    expect(result.pushed).toBe(0);
    expect(result.pulled).toBe(0);
  });

  it('should prevent concurrent syncs via lock', async () => {
    let resolvePush: () => void;
    const pushPromise = new Promise<void>((resolve) => {
      resolvePush = resolve;
    });

    mocks.getPendingItems.mockImplementation(() => pushPromise);

    const syncPromise1 = runSyncCycle();
    await vi.advanceTimersByTimeAsync(0);

    const result2 = await runSyncCycle();

    expect(result2.pushed).toBe(0);
    expect(result2.pulled).toBe(0);
    expect(result2.failed).toBe(0);

    resolvePush!();
    await syncPromise1;
  });
});

// ============================================================
// Tests — applyServerReports conflict resolution (via runSyncCycle)
// ============================================================

describe('applyServerReports — conflict resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPendingItems.mockResolvedValue([]);
  });

  // Skipped: sync v3 disabled — pullUpdates returns early, applyServerReports
  // is unreachable from runSyncCycle. See sync-engine.ts header.
  it.skip('should NOT call DB update for local pending reports', async () => {
    // This tests the logic inside pullUpdates -> applyServerReports.
    // Since applyServerReports is not exported, we test it through runSyncCycle.
    // We verify by checking that the sync cycle completes without errors.

    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          reports: [
            {
              reportId: 'report-1',
              tenantId: 't1',
              siteId: 's1',
              site: { name: 'Site' },
              userId: 'u1',
              user: { name: 'User' },
              date: '2026-04-07',
              shiftType: 'DAY',
              status: 'submitted',
              version: 5,
              createdAt: '2026-04-07T08:00:00Z',
              updatedAt: '2026-04-07T09:00:00Z',
              piles: [],
              drillings: [],
              downtimes: [],
            },
          ],
          events: [],
          cursor: 100,
        }),
    });

    const result = await runSyncCycle();
    expect(result.pulled).toBe(1);
  });

  // Skipped: sync v3 disabled — pullUpdates returns early. See sync-engine.ts.
  it.skip('should upsert new server reports', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          reports: [
            {
              reportId: 'report-new',
              tenantId: 't1',
              siteId: 's1',
              site: { name: 'New Site' },
              userId: 'u1',
              user: { name: 'New User' },
              date: '2026-04-06',
              shiftType: 'NIGHT',
              status: 'submitted',
              version: 1,
              createdAt: '2026-04-06T20:00:00Z',
              updatedAt: '2026-04-06T22:00:00Z',
              piles: [],
              drillings: [],
              downtimes: [],
            },
          ],
          events: [],
          cursor: 200,
        }),
    });

    const result = await runSyncCycle();
    expect(result.pulled).toBe(1);
  });
});

// ============================================================
// Tests — manualSync
// ============================================================

describe('manualSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPendingItems.mockResolvedValue([]);
  });

  it('should delegate to runSyncCycle', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ reports: [], events: [], cursor: 0 }),
    });

    const result = await manualSync();

    expect(result).toHaveProperty('pushed');
    expect(result).toHaveProperty('pulled');
    expect(result).toHaveProperty('failed');
  });
});

// ============================================================
// Tests — getSyncStatusUI
// ============================================================

describe('getSyncStatusUI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.skip('should return combined status from outbox and sync state', async () => {
    // Skipped: Dexie mock complexity — see audit N-2 (sync v3 deferred).
    mocks.getSyncStatus.mockResolvedValue({ pending: 3, failed: 1 });

    Object.defineProperty(navigator, 'onLine', {
      value: true,
      writable: true,
      configurable: true,
    });

    const status = await getSyncStatusUI();

    expect(status.isOnline).toBe(true);
    expect(status.isSyncing).toBe(false);
    expect(status.pending).toBe(3);
    expect(status.failed).toBe(1);
  });
});

// ============================================================
// Tests — startAutoSync / stopAutoSync
// ============================================================

describe('startAutoSync / stopAutoSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should register event listeners on start', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const docSpy = vi.spyOn(document, 'addEventListener');

    startAutoSync();

    expect(addSpy).toHaveBeenCalledWith('online', expect.any(Function));
    expect(docSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

    stopAutoSync();
  });

  // Skipped: sync v3 disabled — visibility triggers a sync cycle but
  // pushOutbox/pullUpdates return early. See sync-engine.ts.
  it.skip('should trigger sync on visibility change when online', async () => {
    mocks.getPendingItems.mockResolvedValue([]);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ reports: [], events: [], cursor: 0 }),
    });

    const originalVisibility = document.visibilityState;
    const originalOnLine = navigator.onLine;

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true,
    });

    startAutoSync();

    document.dispatchEvent(new Event('visibilitychange'));

    await vi.advanceTimersByTimeAsync(100);

    expect(mockFetch).toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', {
      value: originalVisibility,
      configurable: true,
    });
    Object.defineProperty(navigator, 'onLine', {
      value: originalOnLine,
      configurable: true,
    });

    stopAutoSync();
  });
});
