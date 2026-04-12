/**
 * Vector Clock — Unit Tests
 *
 * Tests cover:
 * - Basic increment/merge
 * - Causal ordering detection
 * - Concurrent modification detection
 * - Server-authoritative merge with vector clocks
 * - Edge cases (empty clocks, single-device, etc.)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  VectorClock,
  determineConflictType,
  mergeWithVectorClocks,
} from '@/shared/sync/vector-clock';
import type { VectorClockData } from '@/shared/sync/vector-clock';

// ============================================================
// Vector Clock Core
// ============================================================

describe('VectorClock — Core Operations', () => {
  it('starts with zero for the device', () => {
    const vc = VectorClock.empty('device-a');
    expect(vc.snapshot()).toEqual({ 'device-a': 0 });
  });

  it('increments the device counter', () => {
    const vc = VectorClock.empty('device-a');
    vc.increment();
    expect(vc.snapshot()).toEqual({ 'device-a': 1 });

    vc.increment();
    expect(vc.snapshot()).toEqual({ 'device-a': 2 });
  });

  it('merges with a remote clock and increments own device', () => {
    const vcA = new VectorClock('device-a', { 'device-a': 3 });
    vcA.merge({ 'device-b': 5 });

    expect(vcA.snapshot()['device-a']).toBe(4); // 3 + 1 (after merge increment)
    expect(vcA.snapshot()['device-b']).toBe(5);
  });

  it('takes max of each component during merge', () => {
    const vcA = new VectorClock('device-a', { 'device-a': 10, 'device-b': 5 });
    vcA.merge({ 'device-b': 8, 'device-c': 3 });

    // device-a incremented after merge (acknowledges receipt)
    expect(vcA.snapshot()['device-a']).toBe(11); // 10 + 1
    expect(vcA.snapshot()['device-b']).toBe(8);  // max(5, 8)
    expect(vcA.snapshot()['device-c']).toBe(3);  // from remote
  });

  it('serializes and deserializes correctly', () => {
    const vc = new VectorClock('device-a', { 'device-a': 5, 'device-b': 3 });
    const json = vc.toJSON();
    const restored = VectorClock.fromJSON('device-a', json);

    expect(restored.snapshot()).toEqual(vc.snapshot());
  });

  it('static mergeClocks merges without incrementing', () => {
    const a: VectorClockData = { 'device-a': 3, 'device-b': 5 };
    const b: VectorClockData = { 'device-b': 2, 'device-c': 7 };

    const merged = VectorClock.mergeClocks(a, b);

    expect(merged).toEqual({
      'device-a': 3,
      'device-b': 5, // max(5, 2)
      'device-c': 7,
    });
  });
});

// ============================================================
// Vector Clock — Causal Ordering
// ============================================================

describe('VectorClock — Causal Ordering', () => {
  it('detects "before" relationship', () => {
    const vcA = new VectorClock('device-a', { 'device-a': 1, 'device-b': 2 });
    const result = vcA.compare({ 'device-a': 2, 'device-b': 5 });

    expect(result).toBe('before');
  });

  it('detects "after" relationship', () => {
    const vcA = new VectorClock('device-a', { 'device-a': 5, 'device-b': 3 });
    const result = vcA.compare({ 'device-a': 2, 'device-b': 1 });

    expect(result).toBe('after');
  });

  it('detects concurrent modifications (true conflict)', () => {
    // device-a did more, device-b did more — neither dominates
    const vcA = new VectorClock('device-a', { 'device-a': 5, 'device-b': 2 });
    const result = vcA.compare({ 'device-a': 2, 'device-b': 5 });

    expect(result).toBe('concurrent');
  });

  it('detects equal clocks (same event)', () => {
    const vcA = new VectorClock('device-a', { 'device-a': 3, 'device-b': 5 });
    const result = vcA.compare({ 'device-a': 3, 'device-b': 5 });

    expect(result).toBe('equal');
  });

  it('handles partial clocks (unknown devices treated as 0)', () => {
    const vcA = new VectorClock('device-a', { 'device-a': 3 });
    const result = vcA.compare({ 'device-a': 3, 'device-b': 1 });

    expect(result).toBe('before'); // device-b: 0 < 1
  });

  it('dominates returns true when >= all components', () => {
    const vcA = new VectorClock('device-a', { 'device-a': 5, 'device-b': 3 });

    expect(vcA.dominates({ 'device-a': 3, 'device-b': 2 })).toBe(true);
    expect(vcA.dominates({ 'device-a': 5, 'device-b': 3 })).toBe(true); // equal = dominates
    expect(vcA.dominates({ 'device-a': 6, 'device-b': 2 })).toBe(false);
  });

  it('isConcurrentWith is a convenience wrapper', () => {
    const vcA = new VectorClock('device-a', { 'device-a': 5, 'device-b': 2 });

    expect(vcA.isConcurrentWith({ 'device-a': 2, 'device-b': 5 })).toBe(true);
    expect(vcA.isConcurrentWith({ 'device-a': 1, 'device-b': 1 })).toBe(false);
  });
});

// ============================================================
// determineConflictType
// ============================================================

describe('determineConflictType', () => {
  it('returns "duplicate" for identical clocks', () => {
    const a: VectorClockData = { 'device-a': 3, 'device-b': 5 };
    const b: VectorClockData = { 'device-a': 3, 'device-b': 5 };

    expect(determineConflictType(a, b)).toBe('duplicate');
  });

  it('returns "no_conflict" when one causally precedes the other', () => {
    const client: VectorClockData = { 'device-a': 1, 'device-b': 2 };
    const server: VectorClockData = { 'device-a': 2, 'device-b': 5 };

    expect(determineConflictType(client, server)).toBe('no_conflict');
  });

  it('returns "concurrent" for true concurrent modifications', () => {
    const client: VectorClockData = { 'device-a': 5, 'device-b': 2 };
    const server: VectorClockData = { 'device-a': 2, 'device-b': 5 };

    expect(determineConflictType(client, server)).toBe('concurrent');
  });

  it('handles empty clocks gracefully', () => {
    expect(determineConflictType({}, {})).toBe('duplicate');
    expect(determineConflictType({ 'device-a': 1 }, {})).toBe('no_conflict');
    expect(determineConflictType({}, { 'device-a': 1 })).toBe('no_conflict');
  });
});

// ============================================================
// mergeWithVectorClocks
// ============================================================

describe('mergeWithVectorClocks', () => {
  it('merges data with server wins on critical fields', () => {
    const clientData = {
      id: 'report-1',
      status: 'submitted',     // critical → server wins
      date: '2026-04-10',     // critical → server wins
      shiftStart: '08:00',    // non-critical → client wins
      comment: 'client note', // non-critical → client wins
    };

    const serverData = {
      id: 'report-1',
      status: 'draft',
      date: '2026-04-09',
      shiftStart: '06:00',
      comment: 'server note',
    };

    const clientVC: VectorClockData = { 'device-a': 5, 'device-b': 2 };
    const serverVC: VectorClockData = { 'device-a': 2, 'device-b': 5 };

    const result = mergeWithVectorClocks(clientData, serverData, clientVC, serverVC);

    // Critical fields → server wins
    expect(result.merged.status).toBe('draft');
    expect(result.merged.date).toBe('2026-04-09');

    // Non-critical → client wins
    expect(result.merged.shiftStart).toBe('08:00');
    expect(result.merged.comment).toBe('client note');

    // Conflict fields tracked
    expect(result.conflictFields).toContain('status');
    expect(result.conflictFields).toContain('comment');
  });

  it('merges collections by ID (union)', () => {
    const clientData = {
      piles: [
        { id: 'pile-1', count: 10 },
        { id: 'pile-2', count: 20 }, // client-only
      ],
    };

    const serverData = {
      piles: [
        { id: 'pile-1', count: 15 }, // server version
        { id: 'pile-3', count: 30 }, // server-only
      ],
    };

    const result = mergeWithVectorClocks(
      clientData, serverData,
      { 'device-a': 1 }, { 'device-b': 1 }
    );

    // Should have all 3 piles
    expect(result.merged.piles).toHaveLength(3);
    expect((result.merged.piles as any[]).find(p => p.id === 'pile-1')!.count).toBe(15); // server wins
    expect((result.merged.piles as any[]).find(p => p.id === 'pile-2')).toBeDefined();   // client-only
    expect((result.merged.piles as any[]).find(p => p.id === 'pile-3')).toBeDefined();   // server-only
  });

  it('returns merged vector clock (max of both)', () => {
    const clientVC: VectorClockData = { 'device-a': 5, 'device-b': 2 };
    const serverVC: VectorClockData = { 'device-a': 2, 'device-b': 7, 'device-c': 3 };

    const result = mergeWithVectorClocks(
      { id: 'r1' }, { id: 'r1' },
      clientVC, serverVC
    );

    expect(result.mergedVC['device-a']).toBe(5); // max(5, 2)
    expect(result.mergedVC['device-b']).toBe(7); // max(2, 7)
    expect(result.mergedVC['device-c']).toBe(3); // from server
  });

  it('skips fields with identical values', () => {
    const clientData = { id: 'r1', status: 'draft', comment: 'same' };
    const serverData = { id: 'r1', status: 'draft', comment: 'same' };

    const result = mergeWithVectorClocks(
      clientData, serverData,
      { 'device-a': 1 }, { 'device-b': 1 }
    );

    // No conflicts — all values identical
    expect(result.conflictFields).toHaveLength(0);
  });

  it('handles empty data gracefully', () => {
    const result = mergeWithVectorClocks(
      {}, {},
      { 'device-a': 1 }, { 'device-b': 1 }
    );

    expect(result.merged).toEqual({});
    expect(result.mergedVC['device-a']).toBe(1);
    expect(result.mergedVC['device-b']).toBe(1);
  });
});

// ============================================================
// Real-World Scenarios
// ============================================================

describe('VectorClock — Real-World Scenarios', () => {
  it('Scenario: Two devices edit same report offline', () => {
    // Device A creates report (v1)
    const vcA = new VectorClock('device-a', { 'device-a': 1, server: 0 });

    // Device B also has report (edited from v1 server version)
    const vcB: VectorClockData = { 'device-b': 3, server: 0 };

    // Both sync to server concurrently
    const conflictType = vcA.compare(vcB);
    expect(conflictType).toBe('concurrent');

    // Server merges
    const mergeResult = mergeWithVectorClocks(
      { status: 'submitted', comment: 'from A' },
      { status: 'draft', comment: 'from B' },
      vcA.snapshot(),
      vcB
    );

    // Critical field → server wins
    expect(mergeResult.merged.status).toBe('draft');
    // Non-critical → client (A) wins
    expect(mergeResult.merged.comment).toBe('from A');
    // Merged VC includes all devices
    expect(mergeResult.mergedVC['device-a']).toBe(1);
    expect(mergeResult.mergedVC['device-b']).toBe(3);
  });

  it('Scenario: Sequential edits (no conflict)', () => {
    // Device A edits first
    const vcA: VectorClockData = { 'device-a': 3, server: 2 };

    // Device B edits AFTER receiving A's changes
    const vcB: VectorClockData = { 'device-a': 3, 'device-b': 1, server: 2 };

    // B causally happened after A
    const conflictType = determineConflictType(vcA, vcB);
    expect(conflictType).toBe('no_conflict');
  });

  it('Scenario: Idempotent re-sync (duplicate)', () => {
    const clientVC: VectorClockData = { 'device-a': 5, server: 3 };
    const serverVC: VectorClockData = { 'device-a': 5, server: 3 };

    const conflictType = determineConflictType(clientVC, serverVC);
    expect(conflictType).toBe('duplicate');
  });

  it('Scenario: totalEvents tracks sync progress', () => {
    const vc = new VectorClock('device-a', { 'device-a': 5, 'device-b': 3, server: 2 });
    expect(vc.totalEvents()).toBe(10);
  });

  it('Scenario: divergedDevices shows which devices are out of sync', () => {
    const vc = new VectorClock('device-a', { 'device-a': 5, 'device-b': 3, server: 2 });
    const remote: VectorClockData = { 'device-a': 5, 'device-b': 7, server: 2 };

    const diverged = vc.divergedDevices(remote);
    expect(diverged).toContain('device-b');
    expect(diverged).not.toContain('device-a');
    expect(diverged).not.toContain('server');
  });
});
