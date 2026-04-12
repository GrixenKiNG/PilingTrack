/**
 * Sync Batch Results — Partial Success Support
 *
 * F8 Guarantee: Returns exact result per operation — no ambiguity.
 * Client knows precisely which operations succeeded and which failed.
 */

export interface SyncOperationResult {
  opId: string;
  status: 'success' | 'skipped' | 'failed';
  error?: string;
  serverVersion?: number;
  conflict?: {
    clientData: unknown;
    serverData: unknown;
    reason: 'version_conflict' | 'deleted_on_server';
    resolvedData?: unknown;
  };
}

export interface SyncBatchResponse {
  /** Server-side changes to pull to client */
  serverChanges: unknown[];

  /** Per-operation results */
  operations: SyncOperationResult[];

  /** Sync cursor for next request */
  newSyncAt: string;

  /** Summary stats */
  stats: {
    total: number;
    success: number;
    skipped: number;
    failed: number;
    conflicts: number;
  };

  /** System status — indicates if sync was partially degraded */
  systemStatus: {
    outboxBacklog?: number;
    dlqPending?: number;
    circuitBreakersOpen?: string[];
  };
}

/**
 * Build a sync batch response with accurate per-operation tracking.
 */
export function createSyncBatchResponse(): SyncBatchResponse {
  return {
    serverChanges: [],
    operations: [],
    newSyncAt: new Date().toISOString(),
    stats: {
      total: 0,
      success: 0,
      skipped: 0,
      failed: 0,
      conflicts: 0,
    },
    systemStatus: {},
  };
}

/**
 * Record a successful operation.
 */
export function recordSuccess(
  response: SyncBatchResponse,
  opId: string,
  serverVersion?: number
): void {
  response.operations.push({
    opId,
    status: 'success',
    serverVersion,
  });
  response.stats.total++;
  response.stats.success++;
}

/**
 * Record a skipped operation (idempotent duplicate).
 */
export function recordSkipped(response: SyncBatchResponse, opId: string): void {
  response.operations.push({
    opId,
    status: 'skipped',
  });
  response.stats.total++;
  response.stats.skipped++;
}

/**
 * Record a failed operation.
 */
export function recordFailure(
  response: SyncBatchResponse,
  opId: string,
  error: string
): void {
  response.operations.push({
    opId,
    status: 'failed',
    error,
  });
  response.stats.total++;
  response.stats.failed++;
}

/**
 * Record a conflict that was auto-resolved.
 */
export function recordConflict(
  response: SyncBatchResponse,
  opId: string,
  clientData: unknown,
  serverData: unknown,
  reason: 'version_conflict' | 'deleted_on_server',
  resolvedData?: unknown
): void {
  response.operations.push({
    opId,
    status: 'success',
    conflict: { clientData, serverData, reason, resolvedData },
  });
  response.stats.total++;
  response.stats.success++;
  response.stats.conflicts++;
}
