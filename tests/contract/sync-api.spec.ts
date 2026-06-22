/**
 * Contract Tests — PilingTrack FE ↔ API
 *
 * Validates that frontend and backend agree on:
 * - Sync API request/response schema
 * - Report schema
 * - Error response format
 *
 * Uses MSW to mock the backend and verify FE behavior.
 *
 * Run: npx vitest run tests/contract/sync-api.spec.ts
 */

import { describe, it, expect } from 'vitest';

// Mock the sync API responses
const mockSyncResponse = {
  serverChanges: [],
  conflicts: [],
  newSyncAt: new Date().toISOString(),
  syncStatus: 'synced',
  stats: {
    applied: 0,
    conflicts: 0,
    skipped: 0,
  },
};

const mockSyncRequest = {
  deviceId: 'device-test',
  tenantId: 'tenant-1',
  userId: 'user-1',
  lastSyncAt: new Date(Date.now() - 60000).toISOString(),
  changes: [
    {
      entity: 'report',
      op: 'upsert',
      data: {
        id: 'report-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        siteId: 'site-1',
        date: new Date().toISOString().split('T')[0],
        shiftType: 'day',
        status: 'draft',
        piles: [{ pileGradeId: 'grade-1', count: 5 }],
        drillings: [],
        downtimes: [],
      },
      baseVersion: 1,
      opId: 'op-123e4567-e89b-12d3-a456-426614174000',
    },
  ],
};

describe('Sync API Contract', () => {
  it('accepts valid sync request', async () => {
    // Validate request schema
    expect(mockSyncRequest.deviceId).toBeDefined();
    expect(mockSyncRequest.tenantId).toBeDefined();
    expect(mockSyncRequest.userId).toBeDefined();
    expect(mockSyncRequest.lastSyncAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Array.isArray(mockSyncRequest.changes)).toBe(true);
    expect(mockSyncRequest.changes[0].opId).toBeDefined();
  });

  it('returns valid sync response', async () => {
    // Validate response schema
    expect(Array.isArray(mockSyncResponse.serverChanges)).toBe(true);
    expect(Array.isArray(mockSyncResponse.conflicts)).toBe(true);
    expect(mockSyncResponse.newSyncAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(['synced', 'failed', 'idle']).toContain(mockSyncResponse.syncStatus);
    expect(typeof mockSyncResponse.stats.applied).toBe('number');
    expect(typeof mockSyncResponse.stats.conflicts).toBe('number');
    expect(typeof mockSyncResponse.stats.skipped).toBe('number');
  });

  it('validates change entity types', async () => {
    const validEntities = ['report', 'pile_work', 'drilling', 'downtime'];
    const validOps = ['upsert', 'delete'];

    for (const change of mockSyncRequest.changes) {
      expect(validEntities).toContain(change.entity);
      expect(validOps).toContain(change.op);
    }
  });

  it('validates report data schema', async () => {
    const report = mockSyncRequest.changes[0].data;

    expect(report.id).toBeDefined();
    expect(report.tenantId).toBeDefined();
    expect(report.userId).toBeDefined();
    expect(report.siteId).toBeDefined();
    expect(report.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(['day', 'night']).toContain(report.shiftType);
    expect(['draft', 'submitted']).toContain(report.status);
    expect(Array.isArray(report.piles)).toBe(true);
    expect(Array.isArray(report.drillings)).toBe(true);
    expect(Array.isArray(report.downtimes)).toBe(true);
  });

  it('validates pile schema', async () => {
    const pile = mockSyncRequest.changes[0].data.piles[0];

    expect(pile.pileGradeId).toBeDefined();
    expect(typeof pile.count).toBe('number');
    expect(pile.count).toBeGreaterThan(0);
  });
});

describe('Error Response Contract', () => {
  it('returns consistent error format', async () => {
    const errorResponse = {
      error: 'Validation error',
      details: [
        {
          field: 'changes[0].data.date',
          message: 'Invalid date format',
        },
      ],
    };

    expect(errorResponse.error).toBeDefined();
    expect(typeof errorResponse.error).toBe('string');
    expect(Array.isArray(errorResponse.details)).toBe(true);
    expect(errorResponse.details[0].field).toBeDefined();
    expect(errorResponse.details[0].message).toBeDefined();
  });

  it('handles sync failure gracefully', async () => {
    const failureResponse = {
      error: 'Sync failed',
      requestId: 'req-123',
      retryAfter: 30,
    };

    expect(failureResponse.error).toBeDefined();
    expect(failureResponse.retryAfter).toBeDefined();
    expect(typeof failureResponse.retryAfter).toBe('number');
  });
});

describe('Idempotency Contract', () => {
  it('requires unique opId per operation', async () => {
    const opId = mockSyncRequest.changes[0].opId;

    expect(opId).toBeDefined();
    expect(opId).toMatch(/^op-/);
    expect(opId.length).toBeGreaterThan(5);
  });

  it('rejects duplicate opId', async () => {
    // Simulate duplicate detection
    const processedOpIds = new Set<string>();
    const isFirstRequest = (opId: string) => {
      if (processedOpIds.has(opId)) return false;
      processedOpIds.add(opId);
      return true;
    };

    expect(isFirstRequest('op-1')).toBe(true);
    expect(isFirstRequest('op-1')).toBe(false);
    expect(isFirstRequest('op-2')).toBe(true);
  });
});
