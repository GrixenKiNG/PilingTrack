/**
 * Realtime Event Handlers — WS → IndexedDB
 *
 * Processes incoming WebSocket events and updates local state.
 * Integrates with the offline-first architecture.
 */

import { RealtimeEvent } from '@/core/realtime/types/events';
import { getDB } from '@/mobile/db/schema';
import type { LocalReport } from '@/mobile/db/schema';

/**
 * Handle a realtime event and update IndexedDB.
 */
export async function handleRealtimeEvent(event: RealtimeEvent): Promise<void> {
  switch (event.type) {
    case 'report.created':
    case 'report.updated':
    case 'report.submitted':
      await handleReportEvent(event);
      break;

    case 'downtime.added':
      await handleDowntimeEvent(event);
      break;

    case 'alert.created':
      await handleAlertEvent(event);
      break;

    default:
      // Unknown event type — log but don't fail
      console.debug('[Realtime] Unhandled event type:', event.type);
  }
}

/**
 * Update local report from realtime event.
 */
async function handleReportEvent(event: RealtimeEvent): Promise<void> {
  const db = getDB();

  if (event.type === 'report.created') {
    const payload = event.payload as { reportId: string; siteId: string; date: string; shiftType: string };

    const existing = await db.reports.get(payload.reportId);
    if (existing) return; // Already exists — don't overwrite

    await db.reports.put({
      id: payload.reportId,
      tenantId: event.tenantId,
      siteId: payload.siteId,
      siteName: '', // Will be filled by pull sync
      userId: event.userId || '',
      userName: '',
      date: payload.date,
      shiftType: payload.shiftType as 'DAY' | 'NIGHT',
      shiftStart: null,
      shiftEnd: null,
      equipmentId: null,
      status: 'draft',
      syncStatus: 'synced',
      serverVersion: 0,
      localVersion: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastSyncedAt: new Date().toISOString(),
    });
  }

  if (event.type === 'report.updated' || event.type === 'report.submitted') {
    const payload = event.payload as {
      reportId: string;
      totalPiles: number;
      totalDrilling: number;
      totalDowntime: number;
      status: string;
      updatedAt: string;
    };

    const existing = await db.reports.get(payload.reportId);

    // Conflict resolution: if local has pending changes, keep local
    if (existing?.syncStatus === 'pending') return;

    await db.reports.put({
      ...(existing || {
        id: payload.reportId,
        tenantId: event.tenantId,
        siteId: event.siteId || '',
        siteName: '',
        userId: event.userId || '',
        userName: '',
        date: new Date().toISOString().split('T')[0],
        shiftType: 'DAY',
        shiftStart: null,
        shiftEnd: null,
        equipmentId: null,
        status: payload.status,
        syncStatus: 'synced',
        serverVersion: 0,
        localVersion: 0,
        createdAt: new Date().toISOString(),
        lastSyncedAt: new Date().toISOString(),
      }),
      status: payload.status as 'draft' | 'submitted',
      updatedAt: payload.updatedAt,
      lastSyncedAt: new Date().toISOString(),
    });
  }
}

/**
 * Handle downtime event.
 */
async function handleDowntimeEvent(event: RealtimeEvent): Promise<void> {
  const payload = event.payload as {
    reasonId: string;
    reasonName?: string;
    duration: number;
    reportId: string;
  };

  const db = getDB();

  // Upsert downtime entry
  await db.downtimes.put({
    id: `ws_${event.id}`,
    reportId: payload.reportId,
    reasonId: payload.reasonId,
    reasonName: payload.reasonName || '',
    duration: payload.duration,
    comment: null,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Handle alert event — show notification.
 */
async function handleAlertEvent(event: RealtimeEvent): Promise<void> {
  const payload = event.payload as {
    severity: string;
    ruleId: string;
    message: string;
    siteId?: string;
    reportId?: string;
  };

  // Dispatch custom event for UI to pick up
  window.dispatchEvent(new CustomEvent('pilingtrack:alert', {
    detail: {
      severity: payload.severity,
      message: payload.message,
      siteId: payload.siteId,
      reportId: payload.reportId,
      ts: event.ts,
    },
  }));
}
