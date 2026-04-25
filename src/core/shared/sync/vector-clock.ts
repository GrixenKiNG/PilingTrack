/**
 * Vector Clock — Causal Ordering for Distributed Systems
 *
 * Vector clocks solve the fundamental problem of distributed systems:
 * determining the causal relationship between events without relying
 * on physical clocks (which can drift and are unreliable).
 *
 * Unlike Last-Write-Wins (LWW), vector clocks can detect:
 * - Concurrent modifications (true conflicts requiring merge)
 * - Causal ordering (which event happened first)
 * - Missing events (gaps in causal history)
 *
 * Structure: { deviceId: logicalTimestamp, ... }
 *
 * Comparison rules:
 * - VC(a) < VC(b) → a happened before b (causally ordered)
 * - VC(a) > VC(b) → b happened before a (causally ordered)
 * - VC(a) || VC(b) → concurrent (true conflict)
 * - VC(a) == VC(b) → same event (idempotent)
 *
 * Usage:
 *   const vc = new VectorClock('device-abc');
 *   vc.increment();                      // { 'device-abc': 1 }
 *   vc.merge({ 'device-xyz': 3 });       // { 'device-abc': 1, 'device-xyz': 3 }
 *   vc.compare({ 'device-abc': 2 });     // 'before'
 */

export type VectorClockData = Record<string, number>;
export type VectorClockRelation = 'before' | 'after' | 'concurrent' | 'equal';

export class VectorClock {
  private clock: VectorClockData;
  private readonly deviceId: string;

  constructor(deviceId: string, initial: VectorClockData = {}) {
    this.deviceId = deviceId;
    this.clock = { ...initial };
    // Ensure this device has an entry
    if (!(this.deviceId in this.clock)) {
      this.clock[this.deviceId] = 0;
    }
  }

  /**
   * Increment this device's logical timestamp.
   * Call this BEFORE every local write.
   */
  increment(): VectorClockData {
    this.clock[this.deviceId] = (this.clock[this.deviceId] || 0) + 1;
    return this.snapshot();
  }

  /**
   * Merge with a remote vector clock (happened-after semantics).
   * Takes max of each component, then increments own device.
   */
  merge(remote: VectorClockData): VectorClockData {
    const allDevices = new Set([...Object.keys(this.clock), ...Object.keys(remote)]);

    for (const device of allDevices) {
      const local = this.clock[device] || 0;
      const remoteVal = remote[device] || 0;
      this.clock[device] = Math.max(local, remoteVal);
    }

    // Increment own device after merge (acknowledges receipt)
    this.clock[this.deviceId] = (this.clock[this.deviceId] || 0) + 1;

    return this.snapshot();
  }

  /**
   * Compare this clock with a remote clock.
   *
   * Returns:
   * - 'before'     → this causally happened before remote
   * - 'after'      → remote causally happened before this
   * - 'concurrent' → neither happened before the other (CONFLICT)
   * - 'equal'      → identical clocks (same event)
   */
  compare(remote: VectorClockData): VectorClockRelation {
    const allDevices = new Set([...Object.keys(this.clock), ...Object.keys(remote)]);

    let thisBefore = false;
    let thisAfter = false;

    for (const device of allDevices) {
      const local = this.clock[device] || 0;
      const remoteVal = remote[device] || 0;

      if (local < remoteVal) thisBefore = true;
      if (local > remoteVal) thisAfter = true;
    }

    if (thisBefore && thisAfter) return 'concurrent';
    if (thisBefore) return 'before';
    if (thisAfter) return 'after';
    return 'equal';
  }

  /**
   * Check if this clock causally subsumes another.
   * Returns true if this >= remote for all components.
   */
  dominates(remote: VectorClockData): boolean {
    for (const [device, remoteVal] of Object.entries(remote)) {
      if ((this.clock[device] || 0) < remoteVal) return false;
    }
    return true;
  }

  /**
   * Check if two events are concurrent (true conflict).
   */
  isConcurrentWith(remote: VectorClockData): boolean {
    return this.compare(remote) === 'concurrent';
  }

  /**
   * Get the total number of events across all devices.
   */
  totalEvents(): number {
    return Object.values(this.clock).reduce((sum, v) => sum + v, 0);
  }

  /**
   * Get devices that have diverged from remote.
   * Returns devices where local != remote.
   */
  divergedDevices(remote: VectorClockData): string[] {
    const allDevices = new Set([...Object.keys(this.clock), ...Object.keys(remote)]);
    return Array.from(allDevices).filter(
      (d) => (this.clock[d] || 0) !== (remote[d] || 0)
    );
  }

  /**
   * Get a snapshot of the current clock state.
   */
  snapshot(): VectorClockData {
    return { ...this.clock };
  }

  /**
   * Serialize to JSON for network transmission.
   */
  toJSON(): VectorClockData {
    return this.snapshot();
  }

  /**
   * Deserialize from JSON.
   */
  static fromJSON(deviceId: string, data: VectorClockData): VectorClock {
    return new VectorClock(deviceId, data);
  }

  /**
   * Create an empty vector clock for a device.
   */
  static empty(deviceId: string): VectorClock {
    return new VectorClock(deviceId);
  }

  /**
   * Merge two vector clocks without a specific device context.
   * Returns merged data (no increment).
   */
  static mergeClocks(a: VectorClockData, b: VectorClockData): VectorClockData {
    const result: VectorClockData = { ...a };
    for (const [device, val] of Object.entries(b)) {
      result[device] = Math.max(result[device] || 0, val);
    }
    return result;
  }
}

/**
 * Determine conflict type using vector clocks.
 *
 * Returns:
 * - 'no_conflict'     → one event causally precedes the other
 * - 'concurrent'      → true concurrent modification (needs merge)
 * - 'duplicate'       → same event (idempotent, skip)
 */
export function determineConflictType(
  clientVC: VectorClockData,
  serverVC: VectorClockData
): 'no_conflict' | 'concurrent' | 'duplicate' {
  const allDevices = new Set([...Object.keys(clientVC), ...Object.keys(serverVC)]);

  let clientBefore = false;
  let clientAfter = false;

  for (const device of allDevices) {
    const client = clientVC[device] || 0;
    const server = serverVC[device] || 0;

    if (client < server) clientBefore = true;
    if (client > server) clientAfter = true;
  }

  if (clientBefore && clientAfter) return 'concurrent';
  if (!clientBefore && !clientAfter) return 'duplicate';
  return 'no_conflict';
}

/**
 * Server-authoritative merge strategy with vector clocks.
 *
 * When concurrent modifications detected:
 * 1. Server wins on critical fields (status, date, siteId, userId)
 * 2. Client wins on non-critical fields (shiftStart, shiftEnd, comments)
 * 3. Collections (piles, drillings, downtimes) → union by ID
 * 4. Result vector clock = max(client, server) + server increment
 */
export function mergeWithVectorClocks(
  clientData: Record<string, unknown>,
  serverData: Record<string, unknown>,
  clientVC: VectorClockData,
  serverVC: VectorClockData
): {
  merged: Record<string, unknown>;
  mergedVC: VectorClockData;
  conflictFields: string[];
} {
  const CRITICAL_FIELDS = new Set([
    'status', 'date', 'siteId', 'userId', 'tenantId', 'version',
    'updatedAt', 'createdAt', 'deleted',
  ]);

  const conflictFields: string[] = [];
  const merged: Record<string, unknown> = { ...serverData };

  for (const [key, clientVal] of Object.entries(clientData)) {
    const serverVal = serverData[key];

    if (JSON.stringify(clientVal) === JSON.stringify(serverVal)) {
      continue; // Same value, no conflict
    }

    // Critical fields → server wins
    if (CRITICAL_FIELDS.has(key)) {
      conflictFields.push(key);
      continue; // Keep server value
    }

    // Non-critical → client wins (more recent)
    conflictFields.push(key);
    merged[key] = clientVal;
  }

  // Merge collections (piles, drillings, downtimes)
  const COLLECTION_KEYS = ['piles', 'drillings', 'downtimes'];
  for (const key of COLLECTION_KEYS) {
    const clientItems = clientData[key];
    const serverItems = serverData[key];

    if (Array.isArray(clientItems) && Array.isArray(serverItems)) {
      const mergedCollection = mergeCollectionsById(clientItems, serverItems);
      if (mergedCollection.length !== serverItems.length) {
        conflictFields.push(key);
      }
      merged[key] = mergedCollection;
    }
  }

  // Merged vector clock = max of both + server increment
  const mergedVC = VectorClock.mergeClocks(clientVC, serverVC);

  return { merged, mergedVC, conflictFields };
}

/**
 * Merge two collections by ID:
 * - Only on client → add
 * - Only on server → keep
 * - On both → server wins
 */
function mergeCollectionsById(
  clientItems: unknown[],
  serverItems: unknown[]
): unknown[] {
  const serverMap = new Map<string, unknown>(
    serverItems
      .filter((i): i is Record<string, unknown> => isRecord(i) && i.id != null)
      .map((item) => [(item as Record<string, unknown>).id as string, item])
  );

  const result = new Map<string, unknown>();

  // Server items first
  for (const [id, item] of serverMap) {
    result.set(id, item);
  }

  // Client-only items
  for (const item of clientItems) {
    if (!isRecord(item) || item.id == null) continue;
    const id = item.id as string;
    if (!serverMap.has(id)) {
      result.set(id, item);
    }
  }

  return Array.from(result.values());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
