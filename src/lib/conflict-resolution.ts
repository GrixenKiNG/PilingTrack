/**
 * Last-Write-Wins (LWW) Conflict Resolution
 *
 * Used for offline-first sync when multiple clients modify the same record.
 * The latest `updatedAt` timestamp always wins.
 *
 * Usage:
 *   const resolved = resolveConflictLWW(serverRecord, clientRecord);
 *   if (resolved === 'server') { /* keep server data * / }
 *   if (resolved === 'client') { /* apply client data * / }
 *   if (resolved === 'merge') { /* both can be merged * / }
 */

export type ConflictResolution = 'server' | 'client' | 'merge';

export interface ConflictResolutionResult {
  winner: ConflictResolution;
  serverUpdatedAt: Date;
  clientUpdatedAt: Date;
  timeDiffMs: number;
}

/**
 * Resolve a conflict using Last-Write-Wins strategy.
 *
 * @param serverUpdatedAt - Server record's last update time
 * @param clientUpdatedAt - Client record's last update time
 * @param mergeThresholdMs - If time diff is below this, suggest merge
 * @returns Resolution result
 */
export function resolveConflictLWW(
  serverUpdatedAt: Date,
  clientUpdatedAt: Date,
  mergeThresholdMs = 1000 // 1 second
): ConflictResolutionResult {
  const serverTime = serverUpdatedAt.getTime();
  const clientTime = clientUpdatedAt.getTime();
  const timeDiffMs = Math.abs(clientTime - serverTime);

  // If within merge threshold, both writes are recent — suggest merge
  if (timeDiffMs <= mergeThresholdMs) {
    return {
      winner: 'merge',
      serverUpdatedAt,
      clientUpdatedAt,
      timeDiffMs,
    };
  }

  // Last write wins
  const winner: ConflictResolution = clientTime > serverTime ? 'client' : 'server';

  return {
    winner,
    serverUpdatedAt,
    clientUpdatedAt,
    timeDiffMs,
  };
}

/**
 * Apply LWW resolution to a report sync operation.
 * If server wins, client data is discarded.
 * If client wins, server accepts client data.
 * If merge, both are applied (requires manual resolution).
 */
export function applyLWWToReportSync(
  serverReport: { updatedAt: Date } | null,
  clientPayload: { updatedAt?: string; [key: string]: unknown },
  mergeThresholdMs = 1000
): {
  action: 'accept_client' | 'reject_client' | 'needs_merge';
  reason: string;
} {
  if (!serverReport) {
    // No server record — always accept client
    return { action: 'accept_client', reason: 'No server record exists' };
  }

  const clientUpdatedAt = clientPayload.updatedAt
    ? new Date(clientPayload.updatedAt)
    : new Date(0);

  const result = resolveConflictLWW(
    serverReport.updatedAt,
    clientUpdatedAt,
    mergeThresholdMs
  );

  switch (result.winner) {
    case 'client':
      return {
        action: 'accept_client',
        reason: `Client write is ${result.timeDiffMs}ms newer`,
      };

    case 'server':
      return {
        action: 'reject_client',
        reason: `Server write is ${result.timeDiffMs}ms newer`,
      };

    case 'merge':
      return {
        action: 'needs_merge',
        reason: `Writes are within ${result.timeDiffMs}ms — conflict requires merge`,
      };
  }
}

/**
 * Generate a monotonically increasing sequence number
 * for event ordering within a session.
 */
export class SequenceGenerator {
  private sequence = 0;
  private baseTimestamp: number;

  constructor() {
    this.baseTimestamp = Date.now();
  }

  /**
   * Get next sequence number.
   * Format: {baseTimestamp}_{sequence}
   * Ensures global ordering across sessions.
   */
  next(): string {
    this.sequence++;
    return `${this.baseTimestamp}_${this.sequence.toString().padStart(6, '0')}`;
  }

  /**
   * Reset sequence (e.g., after reconnect).
   * Uses current time as new base to maintain ordering.
   */
  reset(): void {
    this.baseTimestamp = Date.now();
    this.sequence = 0;
  }
}

/**
 * Compare two sequence IDs for ordering.
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareSequences(a: string, b: string): number {
  const [aTime, aSeq] = a.split('_').map(Number);
  const [bTime, bSeq] = b.split('_').map(Number);

  if (aTime !== bTime) return aTime < bTime ? -1 : 1;
  if (aSeq !== bSeq) return aSeq < bSeq ? -1 : 1;
  return 0;
}
