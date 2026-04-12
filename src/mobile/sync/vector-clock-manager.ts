/**
 * Client Vector Clock Manager
 *
 * Manages vector clocks for offline-first sync on the client side.
 * Each report has its own vector clock that tracks causal history.
 *
 * Usage:
 *   const vc = clientVCManager.getOrCreateVC('report-123');
 *   vc.increment(); // before each local edit
 *   await saveReport({ ...data, vectorClock: vc.snapshot() });
 */

import { VectorClock } from '@/shared/sync/vector-clock';
import type { VectorClockData } from '@/shared/sync/vector-clock';
import { getDB } from '../db/schema';

const DEVICE_ID_KEY = 'device-id';

/**
 * Get or generate a stable device ID for this client.
 * Stored in IndexedDB syncMeta for persistence across sessions.
 */
export async function getDeviceId(): Promise<string> {
  const db = getDB();
  const meta = await db.syncMeta.get(DEVICE_ID_KEY);

  if (meta && meta.value) {
    return meta.value as string;
  }

  // Generate new device ID
  const deviceId = `device-${crypto.randomUUID().slice(0, 8)}`;
  await db.syncMeta.put({
    key: DEVICE_ID_KEY,
    value: deviceId,
    updatedAt: Date.now(),
  });

  return deviceId;
}

/**
 * Get or create a vector clock for a specific report.
 * If the report doesn't have a VC yet, create one initialized with device ID.
 */
export async function getOrCreateReportVC(reportId: string): Promise<VectorClock> {
  const db = getDB();
  const report = await db.reports.get(reportId);

  if (report?.vectorClock) {
    const deviceId = await getDeviceId();
    return VectorClock.fromJSON(deviceId, report.vectorClock);
  }

  // Create new VC for this report
  const deviceId = await getDeviceId();
  return VectorClock.empty(deviceId);
}

/**
 * Increment vector clock before a local edit.
 * Returns the updated vector clock data to attach to the change.
 */
export async function incrementReportVC(reportId: string): Promise<VectorClockData> {
  const db = getDB();
  const vc = await getOrCreateReportVC(reportId);
  const vcData = vc.increment();

  // Persist to local report
  await db.reports.update(reportId, { vectorClock: vcData });

  return vcData;
}

/**
 * Merge server vector clock into local report's vector clock.
 * Called when receiving server updates during pull sync.
 */
export async function mergeServerVC(
  reportId: string,
  serverVC: VectorClockData
): Promise<VectorClockData> {
  const db = getDB();
  const vc = await getOrCreateReportVC(reportId);
  const merged = vc.merge(serverVC);

  // Persist merged VC
  await db.reports.update(reportId, { vectorClock: merged });

  return merged;
}

/**
 * Attach vector clock to an outbox entry before sync.
 * This ensures every sync operation carries causal ordering info.
 */
export async function attachVCToOutboxEntry(
  entityId: string,
  outboxPayload: Record<string, unknown>
): Promise<Record<string, unknown> & { vectorClock?: VectorClockData }> {
  const vcData = await incrementReportVC(entityId);

  return {
    ...outboxPayload,
    vectorClock: vcData,
  };
}

/**
 * Apply server vector clock to a local report during pull sync.
 * If local report has no VC, initialize from server.
 */
export async function applyServerVCToReport(
  reportId: string,
  serverVC: VectorClockData
): Promise<void> {
  const db = getDB();
  const report = await db.reports.get(reportId);

  if (!report) return; // Report doesn't exist locally

  if (report.vectorClock) {
    // Merge with existing VC
    await mergeServerVC(reportId, serverVC);
  } else {
    // Initialize from server
    const deviceId = await getDeviceId();
    const vc = VectorClock.fromJSON(deviceId, serverVC);
    await db.reports.update(reportId, { vectorClock: vc.snapshot() });
  }
}
