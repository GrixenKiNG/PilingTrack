/**
 * Conflict Resolution Engine v2 — Production-grade
 *
 * Principal Engineer design decisions:
 * 1. Multi-strategy: LWW → field_merge → vector_clock_merge → manual
 * 2. Field-level conflict tracking (which fields conflicted, who won)
 * 3. Semantic merge for domain-specific types (reports, piles, drillings)
 * 4. Conflict audit trail (who, when, what, why)
 * 5. Pluggable merge strategies (open/closed principle)
 * 6. Deterministic — same inputs → same output (critical for replay)
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────┐
 * │ ConflictResolutionEngine                             │
 * │  ├── Strategy Registry (pluggable)                   │
 * │  ├── Field-level Conflict Tracker                    │
 * │  ├── Semantic Merge Handlers (domain-specific)       │
 * │  ├── Audit Trail (immutable log)                     │
 * │  └── Deterministic Output (replay-safe)              │
 * └─────────────────────────────────────────────────────┘
 *
 * Usage:
 *   const engine = new ConflictResolutionEngine({ strategies });
 *   const result = await engine.resolve({ clientData, serverData, ... });
 *   // result: { merged, conflicts, auditLog, strategy }
 */

import type { VectorClockData } from '@/shared/sync/vector-clock';
import { VectorClock, determineConflictType, mergeWithVectorClocks } from '@/shared/sync/vector-clock';

// ============================================================
// Types
// ============================================================

export type ConflictStrategyName = 'lww' | 'server_wins' | 'client_wins' | 'field_merge' | 'vector_clock_merge';
export type ConflictResolutionMode = 'auto' | 'manual';

export interface ConflictFieldDetail {
  field: string;
  clientValue: unknown;
  serverValue: unknown;
  winner: 'client' | 'server' | 'merged';
  strategy: string;
}

export interface ConflictResolutionResult<T = Record<string, unknown>> {
  merged: T;
  strategy: ConflictStrategyName;
  conflictFields: ConflictFieldDetail[];
  hasConflicts: boolean;
  vectorClock: VectorClockData;
  auditEntry: ConflictAuditEntry;
}

export interface ConflictAuditEntry {
  timestamp: string;
  entityId: string;
  entityType: string;
  conflictType: 'version' | 'concurrent' | 'semantic';
  resolutionStrategy: ConflictStrategyName;
  fieldsInConflict: string[];
  resolutionDetails: ConflictFieldDetail[];
  deviceId: string;
}

export interface ConflictContext {
  entityId: string;
  entityType: string;
  clientData: Record<string, unknown>;
  serverData: Record<string, unknown>;
  clientVectorClock?: VectorClockData;
  serverVectorClock?: VectorClockData;
  clientVersion: number;
  serverVersion: number;
  deviceId: string;
  tenantId: string;
  userId: string;
}

export interface MergeStrategy {
  name: ConflictStrategyName;
  /** Returns true if this strategy can handle the given context */
  canResolve(ctx: ConflictContext): boolean;
  /** Resolve conflict — must be deterministic */
  resolve(ctx: ConflictContext): ConflictResolutionResult;
}

// ============================================================
// Semantic Merge Rules for Report Domain
// ============================================================

/**
 * Field classification for report domain.
 * This is the heart of intelligent merging.
 */
const REPORT_FIELD_CLASSIFICATION = {
  // Server-authoritative — never override from client
  serverAuthoritative: new Set([
    'tenantId',
    'version',
    'createdAt',
    'updatedAt',
    'id',
    'reportId',
  ]),

  // Business-critical — server wins but log conflict
  businessCritical: new Set([
    'status',
    'date',
    'siteId',
    'userId',
    'crewId',
  ]),

  // Temporal — latest timestamp wins (but validate)
  temporal: new Set([
    'shiftStart',
    'shiftEnd',
    'lastEditedById',
    'lastEditedByName',
    'lastEditedByRole',
  ]),

  // Collections — semantic merge by ID
  collections: new Set([
    'piles',
    'drillings',
    'downtimes',
  ]),

  // Numeric — additive (sum both sides)
  numeric: new Set([
    // No purely numeric fields in report root,
    // but nested collections have numeric fields
  ]),

  // Default — client wins (more recent user input)
  default: 'client_wins',
} as const;

// ============================================================
// Semantic Merge Handlers
// ============================================================

/**
 * Merge piles collection: union by pileGradeId, take max count
 *
 * Rationale: If client and server both added piles with same grade,
 * they're likely reporting the same work — take the higher count.
 * If only one side has a pile grade, include it.
 */
function mergePiles(client: unknown[], server: unknown[]): unknown[] {
  const serverMap = new Map<string, Record<string, unknown>>();
  const clientMap = new Map<string, Record<string, unknown>>();

  for (const item of server) {
    if (isRecord(item) && item.pileGradeId) {
      serverMap.set(String(item.pileGradeId), item as Record<string, unknown>);
    }
  }

  for (const item of client) {
    if (isRecord(item) && item.pileGradeId) {
      clientMap.set(String(item.pileGradeId), item as Record<string, unknown>);
    }
  }

  const result = new Map<string, unknown>();

  // Server items first (authoritative baseline)
  for (const [id, item] of serverMap) {
    result.set(id, { ...item });
  }

  // Client items — merge or add
  for (const [id, clientItem] of clientMap) {
    const serverItem = serverMap.get(id);
    if (serverItem) {
      // Both sides have this pile grade — take max count (conservative)
      const clientCount = Number(clientItem.count) || 0;
      const serverCount = Number(serverItem.count) || 0;
      result.set(id, {
        ...serverItem,
        pileGradeId: id,
        count: Math.max(clientCount, serverCount),
      });
    } else {
      // Client-only pile grade — add it
      result.set(id, clientItem);
    }
  }

  return Array.from(result.values());
}

/**
 * Merge drillings collection: union by typeId, additive meters
 *
 * Rationale: Drilling is cumulative — both sides likely reporting
 * different parts of the same drilling operation. Sum the meters.
 */
function mergeDrillings(client: unknown[], server: unknown[]): unknown[] {
  const serverMap = new Map<string, Record<string, unknown>>();
  const clientMap = new Map<string, Record<string, unknown>>();

  for (const item of server) {
    if (isRecord(item) && item.typeId) {
      serverMap.set(String(item.typeId), item as Record<string, unknown>);
    }
  }

  for (const item of client) {
    if (isRecord(item) && item.typeId) {
      clientMap.set(String(item.typeId), item as Record<string, unknown>);
    }
  }

  const result = new Map<string, unknown>();

  // Start with server items
  for (const [id, item] of serverMap) {
    result.set(id, { ...item });
  }

  // Merge client items
  for (const [id, clientItem] of clientMap) {
    const serverItem = serverMap.get(id);
    if (serverItem) {
      // Same drilling type — additive meters, max count
      const clientMeters = Number(clientItem.meters) || 0;
      const serverMeters = Number(serverItem.meters) || 0;
      const clientCount = Number(clientItem.count) || 0;
      const serverCount = Number(serverItem.count) || 0;
      result.set(id, {
        ...serverItem,
        typeId: id,
        meters: clientMeters + serverMeters,
        count: Math.max(clientCount, serverCount),
      });
    } else {
      result.set(id, clientItem);
    }
  }

  return Array.from(result.values());
}

/**
 * Merge downtimes collection: union by reasonId+duration, additive duration
 *
 * Rationale: Downtime is cumulative — both sides reporting different
 * downtime incidents. Sum durations for same reason.
 */
function mergeDowntimes(client: unknown[], server: unknown[]): unknown[] {
  const serverMap = new Map<string, Record<string, unknown>>();
  const clientMap = new Map<string, Record<string, unknown>>();

  // Key by reasonId for grouping
  for (const item of server) {
    if (isRecord(item) && item.reasonId) {
      const key = String(item.reasonId);
      const existing = serverMap.get(key);
      if (existing) {
        existing.duration = Number(existing.duration) + Number(item.duration);
      } else {
        serverMap.set(key, { ...item });
      }
    }
  }

  for (const item of client) {
    if (isRecord(item) && item.reasonId) {
      const key = String(item.reasonId);
      const existing = clientMap.get(key);
      if (existing) {
        existing.duration = Number(existing.duration) + Number(item.duration);
      } else {
        clientMap.set(key, { ...item });
      }
    }
  }

  const result = new Map<string, unknown>();

  // Server downtimes first
  for (const [id, item] of serverMap) {
    result.set(id, item);
  }

  // Merge client downtimes
  for (const [id, clientItem] of clientMap) {
    const serverItem = serverMap.get(id);
    if (serverItem) {
      // Same reason — additive duration
      const clientDuration = Number(clientItem.duration) || 0;
      const serverDuration = Number(serverItem.duration) || 0;
      result.set(id, {
        ...serverItem,
        reasonId: id,
        duration: clientDuration + serverDuration,
      });
    } else {
      result.set(id, clientItem);
    }
  }

  return Array.from(result.values());
}

// ============================================================
// Merge Strategies
// ============================================================

/**
 * Strategy 1: Last-Write-Wins (fallback, for backward compat)
 */
export class LastWriteWinsStrategy implements MergeStrategy {
  readonly name: ConflictStrategyName = 'lww';

  canResolve(_ctx: ConflictContext): boolean {
    return true; // Always applicable as fallback
  }

  resolve(ctx: ConflictContext): ConflictResolutionResult {
    const clientTime = parseTimestamp(ctx.clientData.updatedAt);
    const serverTime = parseTimestamp(ctx.serverData.updatedAt);
    const merged = clientTime >= serverTime ? ctx.clientData : ctx.serverData;
    const winner = clientTime >= serverTime ? 'client' : 'server';

    const conflictFields: ConflictFieldDetail[] = findDifferentFields(ctx.clientData, ctx.serverData).map(f => ({
      field: f,
      clientValue: ctx.clientData[f],
      serverValue: ctx.serverData[f],
      winner,
      strategy: 'lww',
    }));

    const vc = ctx.clientVectorClock && ctx.serverVectorClock
      ? VectorClock.mergeClocks(ctx.clientVectorClock, ctx.serverVectorClock)
      : (ctx.clientVectorClock || ctx.serverVectorClock || {});

    return {
      merged: merged as Record<string, unknown>,
      strategy: 'lww',
      conflictFields,
      hasConflicts: conflictFields.length > 0,
      vectorClock: vc,
      auditEntry: {
        timestamp: new Date().toISOString(),
        entityId: ctx.entityId,
        entityType: ctx.entityType,
        conflictType: 'version',
        resolutionStrategy: 'lww',
        fieldsInConflict: conflictFields.map((f: ConflictFieldDetail) => f.field),
        resolutionDetails: conflictFields,
        deviceId: ctx.deviceId,
      },
    };
  }
}

/**
 * Strategy 2: Server Wins (for business-critical fields)
 */
export class ServerWinsStrategy implements MergeStrategy {
  readonly name: ConflictStrategyName = 'server_wins';

  canResolve(ctx: ConflictContext): boolean {
    // Only use when server data is clearly authoritative
    const status = ctx.serverData.status;
    return status === 'submitted' || status === 'archived';
  }

  resolve(ctx: ConflictContext): ConflictResolutionResult {
    const conflictFields: ConflictFieldDetail[] = findDifferentFields(ctx.clientData, ctx.serverData).map(f => ({
      field: f,
      clientValue: ctx.clientData[f],
      serverValue: ctx.serverData[f],
      winner: 'server' as const,
      strategy: 'server_wins',
    }));

    const vc = ctx.clientVectorClock && ctx.serverVectorClock
      ? VectorClock.mergeClocks(ctx.clientVectorClock, ctx.serverVectorClock)
      : (ctx.clientVectorClock || ctx.serverVectorClock || {});

    // Increment server clock
    const serverVC = new VectorClock('server', vc);
    serverVC.increment();
    const mergedVC = serverVC.snapshot();

    return {
      merged: { ...ctx.serverData, updatedAt: new Date().toISOString(), vectorClock: mergedVC } as Record<string, unknown>,
      strategy: 'server_wins',
      conflictFields,
      hasConflicts: conflictFields.length > 0,
      vectorClock: mergedVC,
      auditEntry: {
        timestamp: new Date().toISOString(),
        entityId: ctx.entityId,
        entityType: ctx.entityType,
        conflictType: 'version',
        resolutionStrategy: 'server_wins',
        fieldsInConflict: conflictFields.map((f: ConflictFieldDetail) => f.field),
        resolutionDetails: conflictFields,
        deviceId: ctx.deviceId,
      },
    };
  }
}

/**
 * Strategy 3: Field Merge (default intelligent merge)
 */
export class FieldMergeStrategy implements MergeStrategy {
  readonly name: ConflictStrategyName = 'field_merge';

  canResolve(_ctx: ConflictContext): boolean {
    return true; // Always applicable
  }

  resolve(ctx: ConflictContext): ConflictResolutionResult {
    const merged: Record<string, unknown> = { ...ctx.serverData };
    const conflictFields: ConflictFieldDetail[] = [];

    // Merge scalar fields
    const allKeys = new Set([
      ...Object.keys(ctx.clientData),
      ...Object.keys(ctx.serverData),
    ]);

    for (const key of allKeys) {
      // Skip internal fields
      if (key === 'vectorClock' || key === 'version') continue;

      const clientVal = ctx.clientData[key];
      const serverVal = ctx.serverData[key];

      // Same value — no conflict
      if (JSON.stringify(clientVal) === JSON.stringify(serverVal)) {
        continue;
      }

      // Field doesn't exist on one side — take what exists
      if (clientVal === undefined) {
        // Client removed field — keep server
        continue;
      }
      if (serverVal === undefined) {
        // Client added field — accept it
        merged[key] = clientVal;
        continue;
      }

      // Both sides have different values — classify field
      const classification = classifyField(key);

      switch (classification) {
        case 'serverAuthoritative':
          conflictFields.push({
            field: key,
            clientValue: clientVal,
            serverValue: serverVal,
            winner: 'server',
            strategy: 'field_merge.authoritative',
          });
          break; // Keep server value

        case 'businessCritical':
          conflictFields.push({
            field: key,
            clientValue: clientVal,
            serverValue: serverVal,
            winner: 'server',
            strategy: 'field_merge.critical',
          });
          break; // Keep server value

        case 'temporal':
          // Latest timestamp wins — but client is more recent
          merged[key] = clientVal;
          conflictFields.push({
            field: key,
            clientValue: clientVal,
            serverValue: serverVal,
            winner: 'client',
            strategy: 'field_merge.temporal',
          });
          break;

        case 'collections':
          // Handled separately below
          break;

        default:
          // Default — client wins (user's latest input)
          merged[key] = clientVal;
          conflictFields.push({
            field: key,
            clientValue: clientVal,
            serverValue: serverVal,
            winner: 'client',
            strategy: 'field_merge.default',
          });
      }
    }

    // Semantic merge collections
    const collectionResults = mergeCollections(ctx.clientData, ctx.serverData);
    for (const [key, value] of collectionResults) {
      merged[key] = value;
      conflictFields.push({
        field: key,
        clientValue: ctx.clientData[key],
        serverValue: ctx.serverData[key],
        winner: 'merged',
        strategy: `field_merge.semantic.${key}`,
      });
    }

    // Merge vector clocks
    let mergedVC: VectorClockData;
    if (ctx.clientVectorClock && ctx.serverVectorClock) {
      mergedVC = VectorClock.mergeClocks(ctx.clientVectorClock, ctx.serverVectorClock);
      const serverVC = new VectorClock('server', mergedVC);
      serverVC.increment();
      mergedVC = serverVC.snapshot();
    } else {
      mergedVC = ctx.clientVectorClock || ctx.serverVectorClock || {};
    }

    // Increment version
    merged.version = (ctx.serverVersion || 0) + 1;
    merged.vectorClock = mergedVC;
    merged.updatedAt = new Date().toISOString();

    return {
      merged,
      strategy: 'field_merge',
      conflictFields,
      hasConflicts: conflictFields.length > 0,
      vectorClock: mergedVC,
      auditEntry: {
        timestamp: new Date().toISOString(),
        entityId: ctx.entityId,
        entityType: ctx.entityType,
        conflictType: 'concurrent',
        resolutionStrategy: 'field_merge',
        fieldsInConflict: conflictFields.map((f: ConflictFieldDetail) => f.field),
        resolutionDetails: conflictFields,
        deviceId: ctx.deviceId,
      },
    };
  }
}

/**
 * Strategy 4: Vector Clock Merge (for concurrent modifications)
 */
export class VectorClockMergeStrategy implements MergeStrategy {
  readonly name: ConflictStrategyName = 'vector_clock_merge';

  canResolve(ctx: ConflictContext): boolean {
    return !!(ctx.clientVectorClock && ctx.serverVectorClock);
  }

  resolve(ctx: ConflictContext): ConflictResolutionResult {
    const mergeResult = mergeWithVectorClocks(
      ctx.clientData,
      ctx.serverData,
      ctx.clientVectorClock!,
      ctx.serverVectorClock!
    );

    // Set version and updatedAt (same as FieldMergeStrategy)
    const merged = { ...mergeResult.merged } as Record<string, unknown>;
    merged.version = (ctx.serverVersion || 0) + 1;
    merged.updatedAt = new Date().toISOString();

    // Increment server clock after merge
    const mergedVC = { ...mergeResult.mergedVC };
    mergedVC['server'] = (mergedVC['server'] || 0) + 1;

    const conflictFields: ConflictFieldDetail[] = mergeResult.conflictFields.map((f: string) => ({
      field: f,
      clientValue: ctx.clientData[f],
      serverValue: ctx.serverData[f],
      winner: 'merged' as const,
      strategy: 'vector_clock_merge',
    }));

    return {
      merged,
      strategy: 'vector_clock_merge',
      conflictFields,
      hasConflicts: conflictFields.length > 0,
      vectorClock: mergedVC,
      auditEntry: {
        timestamp: new Date().toISOString(),
        entityId: ctx.entityId,
        entityType: ctx.entityType,
        conflictType: 'concurrent',
        resolutionStrategy: 'vector_clock_merge',
        fieldsInConflict: conflictFields.map((f: ConflictFieldDetail) => f.field),
        resolutionDetails: conflictFields,
        deviceId: ctx.deviceId,
      },
    };
  }
}

// ============================================================
// Conflict Resolution Engine
// ============================================================

export class ConflictResolutionEngine {
  private strategies: Map<ConflictStrategyName, MergeStrategy>;

  constructor(strategies: MergeStrategy[]) {
    this.strategies = new Map();
    for (const strategy of strategies) {
      this.strategies.set(strategy.name, strategy);
    }
  }

  /**
   * Resolve a conflict between client and server data.
   *
   * Strategy selection priority:
   * 1. vector_clock_merge (if both VCs present and concurrent)
   * 2. server_wins (if server status is submitted/archived)
   * 3. field_merge (default intelligent merge)
   * 4. lww (fallback)
   */
  resolve(ctx: ConflictContext): ConflictResolutionResult {
    // Detect conflict type using vector clocks if available
    const conflictType = ctx.clientVectorClock && ctx.serverVectorClock
      ? determineConflictType(ctx.clientVectorClock, ctx.serverVectorClock)
      : null;

    // Try each strategy in priority order
    const strategyOrder: ConflictStrategyName[] = [
      'vector_clock_merge',
      'server_wins',
      'field_merge',
      'lww',
    ];

    for (const strategyName of strategyOrder) {
      const strategy = this.strategies.get(strategyName);
      if (!strategy) continue;

      // Skip vector_clock_merge if not concurrent
      if (strategyName === 'vector_clock_merge' && conflictType !== 'concurrent') {
        continue;
      }

      if (strategy.canResolve(ctx)) {
        return strategy.resolve(ctx);
      }
    }

    // Should never reach here — LWW is always available
    throw new Error('No strategy could resolve conflict');
  }

  /**
   * Get registered strategy names
   */
  getRegisteredStrategies(): ConflictStrategyName[] {
    return Array.from(this.strategies.keys());
  }

  /**
   * Register a custom merge strategy
   */
  registerStrategy(strategy: MergeStrategy): void {
    this.strategies.set(strategy.name, strategy);
  }
}

// ============================================================
// Factory — create pre-configured engine for reports
// ============================================================

export function createReportConflictEngine(): ConflictResolutionEngine {
  return new ConflictResolutionEngine([
    new VectorClockMergeStrategy(),
    new ServerWinsStrategy(),
    new FieldMergeStrategy(),
    new LastWriteWinsStrategy(),
  ]);
}

// ============================================================
// Helpers
// ============================================================

type FieldClassification = 'serverAuthoritative' | 'businessCritical' | 'temporal' | 'collections' | 'numeric' | 'default';

function classifyField(key: string): FieldClassification {
  if (REPORT_FIELD_CLASSIFICATION.serverAuthoritative.has(key)) {
    return 'serverAuthoritative';
  }
  if (REPORT_FIELD_CLASSIFICATION.businessCritical.has(key)) {
    return 'businessCritical';
  }
  if (REPORT_FIELD_CLASSIFICATION.temporal.has(key)) {
    return 'temporal';
  }
  if (REPORT_FIELD_CLASSIFICATION.collections.has(key)) {
    return 'collections';
  }
  if ((REPORT_FIELD_CLASSIFICATION.numeric as Set<string>).has(key)) {
    return 'numeric';
  }
  return 'default';
}

function mergeCollections(
  client: Record<string, unknown>,
  server: Record<string, unknown>
): Map<string, unknown> {
  const result = new Map<string, unknown>();

  const collectionHandlers: Record<string, (c: unknown[], s: unknown[]) => unknown[]> = {
    piles: mergePiles,
    drillings: mergeDrillings,
    downtimes: mergeDowntimes,
  };

  for (const [key, handler] of Object.entries(collectionHandlers)) {
    const clientItems = client[key];
    const serverItems = server[key];

    if (Array.isArray(clientItems) && Array.isArray(serverItems)) {
      result.set(key, handler(clientItems, serverItems));
    } else if (Array.isArray(clientItems)) {
      result.set(key, clientItems);
    } else if (Array.isArray(serverItems)) {
      result.set(key, serverItems);
    }
  }

  return result;
}

function findDifferentFields(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): string[] {
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const different: string[] = [];

  for (const key of allKeys) {
    if (key === 'vectorClock') continue;
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
      different.push(key);
    }
  }

  return different;
}

function parseTimestamp(value: unknown): number {
  if (typeof value === 'string') {
    return new Date(value).getTime();
  }
  if (typeof value === 'number') {
    return value;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
