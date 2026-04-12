/**
 * Unit Tests — Conflict Resolution (LWW)
 *
 * Tests Last-Write-Wins logic, sequence generation, and ordering.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveConflictLWW,
  applyLWWToReportSync,
  SequenceGenerator,
  compareSequences,
} from '@/lib/conflict-resolution';

describe('resolveConflictLWW', () => {
  it('client wins when newer', () => {
    const server = new Date('2024-01-01T10:00:00Z');
    const client = new Date('2024-01-01T10:05:00Z');

    const result = resolveConflictLWW(server, client);

    expect(result.winner).toBe('client');
    expect(result.timeDiffMs).toBe(300_000);
  });

  it('server wins when newer', () => {
    const server = new Date('2024-01-01T10:05:00Z');
    const client = new Date('2024-01-01T10:00:00Z');

    const result = resolveConflictLWW(server, client);

    expect(result.winner).toBe('server');
    expect(result.timeDiffMs).toBe(300_000);
  });

  it('suggests merge when within threshold', () => {
    const server = new Date('2024-01-01T10:00:00.000Z');
    const client = new Date('2024-01-01T10:00:00.500Z');

    const result = resolveConflictLWW(server, client, 1000);

    expect(result.winner).toBe('merge');
    expect(result.timeDiffMs).toBe(500);
  });
});

describe('applyLWWToReportSync', () => {
  it('accepts client when no server record', () => {
    const result = applyLWWToReportSync(null, { updatedAt: '2024-01-01T10:00:00Z' });
    expect(result.action).toBe('accept_client');
  });

  it('accepts client when newer', () => {
    const result = applyLWWToReportSync(
      { updatedAt: new Date('2024-01-01T10:00:00Z') },
      { updatedAt: '2024-01-01T10:05:00Z' }
    );
    expect(result.action).toBe('accept_client');
  });

  it('rejects client when server is newer', () => {
    const result = applyLWWToReportSync(
      { updatedAt: new Date('2024-01-01T10:05:00Z') },
      { updatedAt: '2024-01-01T10:00:00Z' }
    );
    expect(result.action).toBe('reject_client');
  });

  it('needs merge when writes are simultaneous', () => {
    const result = applyLWWToReportSync(
      { updatedAt: new Date('2024-01-01T10:00:00.000Z') },
      { updatedAt: '2024-01-01T10:00:00.200Z' },
      1000
    );
    expect(result.action).toBe('needs_merge');
  });
});

describe('SequenceGenerator', () => {
  it('generates monotonically increasing sequences', () => {
    const gen = new SequenceGenerator();

    const sequences = Array.from({ length: 10 }, () => gen.next());

    for (let i = 1; i < sequences.length; i++) {
      expect(compareSequences(sequences[i - 1], sequences[i])).toBeLessThan(0);
    }
  });

  it('reset creates new base timestamp', () => {
    const gen = new SequenceGenerator();
    const before = gen.next();

    // Small delay to ensure different timestamps
    gen.reset();
    const after = gen.next();

    // After reset, new sequences should be >= before (due to time progression)
    expect(compareSequences(before, after)).toBeLessThanOrEqual(0);
  });
});

describe('compareSequences', () => {
  it('returns -1 when a < b', () => {
    expect(compareSequences('1000_001', '1000_002')).toBe(-1);
    expect(compareSequences('1000_001', '2000_001')).toBe(-1);
  });

  it('returns 0 when equal', () => {
    expect(compareSequences('1000_001', '1000_001')).toBe(0);
  });

  it('returns 1 when a > b', () => {
    expect(compareSequences('1000_002', '1000_001')).toBe(1);
    expect(compareSequences('2000_001', '1000_001')).toBe(1);
  });
});
