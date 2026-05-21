/**
 * Unit tests for handleSync — the orchestration layer of sync v2.
 *
 * Responsibilities under test:
 *   - run processReportChange for each incoming change
 *   - isolate per-change failures (continue processing others)
 *   - pull server changes via getServerChanges
 *   - update DeviceSyncState on success AND failure
 *   - re-throw orchestration-level errors (after recording failure state)
 *
 * Per-row authorization paths live in report-processor.security.test.ts.
 * Conflict resolution paths live in report-processor.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SyncRequest } from '@/core/shared/types/sync';

const mocks = vi.hoisted(() => ({
  initDeviceSyncState: vi.fn().mockResolvedValue(undefined),
  updateDeviceSyncState: vi.fn().mockResolvedValue(undefined),
  processReportChange: vi.fn(),
  getServerChanges: vi.fn().mockResolvedValue([]),
}));

vi.mock('../device-state', () => ({
  initDeviceSyncState: mocks.initDeviceSyncState,
  updateDeviceSyncState: mocks.updateDeviceSyncState,
}));

vi.mock('../report-processor', () => ({
  processReportChange: mocks.processReportChange,
}));

vi.mock('../server-changes', () => ({
  getServerChanges: mocks.getServerChanges,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { handleSync } from '../handler';

function makeRequest(overrides: Partial<SyncRequest> = {}): SyncRequest {
  return {
    deviceId: 'device-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    isPrivileged: false,
    lastSyncAt: '2026-05-20T00:00:00Z',
    changes: [],
    ...overrides,
  } as SyncRequest;
}

function makeChange(opId: string, id: string = 'report-1') {
  return {
    entity: 'report',
    op: 'upsert',
    opId,
    baseVersion: 1,
    data: { id, reportId: id, siteId: 's1', date: '2026-05-20' },
  } as any;
}

describe('handleSync — orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.initDeviceSyncState.mockResolvedValue(undefined);
    mocks.updateDeviceSyncState.mockResolvedValue(undefined);
    mocks.processReportChange.mockResolvedValue({ applied: true });
    mocks.getServerChanges.mockResolvedValue([]);
  });

  it('initialises device state before processing any change', async () => {
    await handleSync(makeRequest());
    expect(mocks.initDeviceSyncState).toHaveBeenCalledWith('device-1', 'tenant-1', 'user-1');
  });

  it('runs processReportChange for each incoming change', async () => {
    const req = makeRequest({
      changes: [makeChange('op-1'), makeChange('op-2'), makeChange('op-3')],
    });

    await handleSync(req);

    expect(mocks.processReportChange).toHaveBeenCalledTimes(3);
    expect(mocks.processReportChange).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ opId: 'op-1' }),
      'tenant-1',
      { userId: 'user-1', isPrivileged: false },
    );
  });

  it('counts applied, skipped, and conflicts correctly', async () => {
    mocks.processReportChange
      .mockResolvedValueOnce({ applied: true })
      .mockResolvedValueOnce({ applied: false })
      .mockResolvedValueOnce({
        applied: true,
        conflict: { entity: 'report', reason: 'version_conflict' } as any,
      });

    const result = await handleSync(
      makeRequest({ changes: [makeChange('a'), makeChange('b'), makeChange('c')] }),
    );

    expect(result.stats).toEqual({ applied: 2, conflicts: 1, skipped: 1 });
    expect(result.conflicts).toHaveLength(1);
  });

  it('isolates per-change failures and keeps processing the rest', async () => {
    // Without isolation a single bad change would 500 the entire batch and
    // the client would re-push the same batch on next sync, multiplying load.
    mocks.processReportChange
      .mockResolvedValueOnce({ applied: true })
      .mockRejectedValueOnce(new Error('processor blew up'))
      .mockResolvedValueOnce({ applied: true });

    const result = await handleSync(
      makeRequest({ changes: [makeChange('a'), makeChange('b'), makeChange('c')] }),
    );

    expect(mocks.processReportChange).toHaveBeenCalledTimes(3);
    expect(result.stats.applied).toBe(2);
    // The failed change is neither applied nor counted as skipped — it's
    // logged. That matches the current intent; if you want it surfaced
    // to the client, extend SyncResponse with a per-change errors field.
  });

  it('includes server changes pulled since lastSyncAt', async () => {
    mocks.getServerChanges.mockResolvedValue([
      { entity: 'report', id: 'r1' } as any,
      { entity: 'report', id: 'r2' } as any,
    ]);

    const result = await handleSync(makeRequest({ lastSyncAt: '2026-05-19T00:00:00Z' }));

    expect(mocks.getServerChanges).toHaveBeenCalledWith('tenant-1', '2026-05-19T00:00:00Z');
    expect(result.serverChanges).toHaveLength(2);
  });

  it('updates device sync state with success metrics on happy path', async () => {
    const lastVC = { 'device-1': 5, server: 3 };
    await handleSync(
      makeRequest({
        changes: [
          { ...makeChange('op-1'), vectorClock: { 'device-1': 4, server: 3 } },
          { ...makeChange('op-2'), vectorClock: lastVC },
        ] as any,
      }),
    );

    expect(mocks.updateDeviceSyncState).toHaveBeenCalledWith(
      'device-1', 'tenant-1', 'user-1',
      expect.objectContaining({
        success: true,
        changesSent: 2,
        changesRecv: 0,
        lastVectorClock: lastVC,
      }),
    );
  });

  it('records failure state and re-throws on orchestration error', async () => {
    // initDeviceSyncState succeeds → enters try block → getServerChanges
    // blows up → catch records failure → re-throws so the route returns 500.
    mocks.getServerChanges.mockRejectedValue(new Error('db unreachable'));

    await expect(handleSync(makeRequest())).rejects.toThrow('db unreachable');

    expect(mocks.updateDeviceSyncState).toHaveBeenCalledWith(
      'device-1', 'tenant-1', 'user-1',
      expect.objectContaining({ success: false, error: 'db unreachable' }),
    );
  });
});
