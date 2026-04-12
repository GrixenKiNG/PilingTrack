/**
 * Client Outbox Service — Offline Write Queue
 *
 * Core of offline-first: every local write goes to IndexedDB + outbox.
 * UI updates instantly (optimistic). Sync happens when network available.
 *
 * Usage:
 *   import { outboxService } from '@/mobile/outbox/outbox-service';
 *   await outboxService.enqueueReportUpdate(reportData);
 */

import { getDB, type LocalReport, type LocalPileWork, type LocalDrilling, type LocalDowntime, type DictionaryEntry, type OutboxEntry } from '../db/schema';
import { attachVCToOutboxEntry } from '../sync/vector-clock-manager';

export class OutboxService {
  private syncInProgress = false;

  // ============================================================
  // Report CRUD → Local DB + Outbox
  // ============================================================

  async enqueueReportCreate(report: LocalReport): Promise<void> {
    const db = getDB();

    await db.transaction('rw', db.reports, db.outbox, async () => {
      // Save locally
      await db.reports.put({ ...report, syncStatus: 'pending' });

      // Attach vector clock
      const vcPayload = await attachVCToOutboxEntry(report.id, report as unknown as Record<string, unknown>);

      // Enqueue for sync
      await db.outbox.add({
        type: 'REPORT_CREATE',
        entity: 'report',
        entityId: report.id,
        payload: vcPayload,
        status: 'pending',
        attempts: 0,
        lastError: null,
        createdAt: Date.now(),
      });
    });
  }

  async enqueueReportUpdate(report: LocalReport): Promise<void> {
    const db = getDB();

    await db.transaction('rw', db.reports, db.outbox, async () => {
      // Update local copy
      await db.reports.put({ ...report, syncStatus: 'pending', localVersion: report.localVersion + 1 });

      // Attach vector clock
      const vcPayload = await attachVCToOutboxEntry(report.id, report as unknown as Record<string, unknown>);

      // Enqueue for sync
      await db.outbox.add({
        type: 'REPORT_UPDATE',
        entity: 'report',
        entityId: report.id,
        payload: vcPayload,
        status: 'pending',
        attempts: 0,
        lastError: null,
        createdAt: Date.now(),
      });
    });
  }

  async enqueueReportDelete(reportId: string): Promise<void> {
    const db = getDB();

    // Split into smaller transactions (Dexie limit)
    await db.transaction('rw', db.reports, async () => {
      await db.reports.update(reportId, { syncStatus: 'pending' });
    });

    await db.outbox.add({
      type: 'REPORT_DELETE',
      entity: 'report',
      entityId: reportId,
      payload: { reportId },
      status: 'pending',
      attempts: 0,
      lastError: null,
      createdAt: Date.now(),
    });
  }

  // ============================================================
  // Read Local Data
  // ============================================================

  async getReport(reportId: string): Promise<LocalReport | undefined> {
    return getDB().reports.get(reportId);
  }

  async getReportsForSite(siteId: string, daysBack = 14): Promise<LocalReport[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    return getDB().reports
      .where('siteId')
      .equals(siteId)
      .and(r => r.date >= cutoffStr)
      .sortBy('date');
  }

  async getReportsForUser(userId: string, daysBack = 14): Promise<LocalReport[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    return getDB().reports
      .where('userId')
      .equals(userId)
      .and(r => r.date >= cutoffStr)
      .sortBy('date');
  }

  async getReportEntries(reportId: string): Promise<{
    report: LocalReport | undefined;
    piles: LocalPileWork[];
    drillings: LocalDrilling[];
    downtimes: LocalDowntime[];
  }> {
    const db = getDB();
    const [report, piles, drillings, downtimes] = await Promise.all([
      db.reports.get(reportId),
      db.pileWork.where('reportId').equals(reportId).toArray(),
      db.drillings.where('reportId').equals(reportId).toArray(),
      db.downtimes.where('reportId').equals(reportId).toArray(),
    ]);

    return { report, piles, drillings, downtimes };
  }

  // ============================================================
  // Save Report Child Entries
  // ============================================================

  async savePileWork(pile: LocalPileWork): Promise<void> {
    await getDB().pileWork.put(pile);
  }

  async saveDrilling(drilling: LocalDrilling): Promise<void> {
    await getDB().drillings.put(drilling);
  }

  async saveDowntime(downtime: LocalDowntime): Promise<void> {
    await getDB().downtimes.put(downtime);
  }

  async saveReportEntries(
    reportId: string,
    piles: LocalPileWork[],
    drillings: LocalDrilling[],
    downtimes: LocalDowntime[]
  ): Promise<void> {
    const db = getDB();

    await db.transaction('rw', db.pileWork, db.drillings, db.downtimes, async () => {
      // Delete existing for this report
      await db.pileWork.where('reportId').equals(reportId).delete();
      await db.drillings.where('reportId').equals(reportId).delete();
      await db.downtimes.where('reportId').equals(reportId).delete();

      // Insert new
      if (piles.length > 0) await db.pileWork.bulkPut(piles);
      if (drillings.length > 0) await db.drillings.bulkPut(drillings);
      if (downtimes.length > 0) await db.downtimes.bulkPut(downtimes);
    });
  }

  // ============================================================
  // Outbox Operations
  // ============================================================

  async getPendingItems(limit = 50): Promise<OutboxEntry[]> {
    return getDB().outbox
      .where('status')
      .equals('pending')
      .limit(limit)
      .sortBy('createdAt');
  }

  async markSyncing(id: number): Promise<void> {
    await getDB().outbox.update(id, { status: 'syncing' });
  }

  async markSynced(id: number): Promise<void> {
    await getDB().outbox.update(id, {
      status: 'synced',
      syncedAt: Date.now(),
    });
  }

  async markFailed(id: number, error: string): Promise<void> {
    const item = await getDB().outbox.get(id);
    const attempts = (item?.attempts ?? 0) + 1;

    await getDB().outbox.update(id, {
      status: 'failed',
      attempts,
      lastError: error.substring(0, 500),
    });
  }

  async resetFailedForRetry(id: number): Promise<void> {
    const item = await getDB().outbox.get(id);
    if (!item) return;

    await getDB().outbox.update(id, {
      status: 'pending',
      attempts: item.attempts + 1,
    });
  }

  async getSyncStatus(): Promise<{
    pending: number;
    syncing: number;
    failed: number;
    synced: number;
  }> {
    const db = getDB();
    const all = await db.outbox.toArray();

    return {
      pending: all.filter(i => i.status === 'pending').length,
      syncing: all.filter(i => i.status === 'syncing').length,
      failed: all.filter(i => i.status === 'failed').length,
      synced: all.filter(i => i.status === 'synced').length,
    };
  }

  async clearOldSynced(daysOld = 7): Promise<number> {
    const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
    const deleted = await getDB().outbox
      .where('status')
      .equals('synced')
      .and(i => (i.syncedAt || 0) < cutoff)
      .delete();

    return deleted;
  }

  // ============================================================
  // Sync Meta
  // ============================================================

  async getLastSyncCursor(): Promise<number> {
    const meta = await getDB().syncMeta.get('lastSyncCursor');
    return meta ? (Number(meta.value) || 0) : 0;
  }

  async setLastSyncCursor(cursor: number): Promise<void> {
    await getDB().syncMeta.put({
      key: 'lastSyncCursor',
      value: cursor,
      updatedAt: Date.now(),
    });
  }

  async getLastPullSync(): Promise<number> {
    const meta = await getDB().syncMeta.get('lastPullSync');
    return meta ? (Number(meta.value) || 0) : 0;
  }

  async setLastPullSync(timestamp: number): Promise<void> {
    await getDB().syncMeta.put({
      key: 'lastPullSync',
      value: timestamp,
      updatedAt: Date.now(),
    });
  }

  // ============================================================
  // Dictionary Cache
  // ============================================================

  async saveDictionaries(entries: DictionaryEntry[]): Promise<void> {
    await getDB().dictionaries.bulkPut(entries);
  }

  async getDictionaries(type: DictionaryEntry['type']): Promise<DictionaryEntry[]> {
    return getDB().dictionaries
      .where('type')
      .equals(type)
      .and(e => e.isActive)
      .toArray();
  }

  // ============================================================
  // Data Cleanup (limit local storage)
  // ============================================================

  async cleanupOldData(daysToKeep = 14): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const db = getDB();

    // Get reports to delete
    const oldReports = await db.reports
      .where('date')
      .below(cutoffStr)
      .and(r => r.syncStatus === 'synced')
      .toArray();

    const reportIds = oldReports.map(r => r.id);

    await db.transaction('rw', db.reports, db.pileWork, db.drillings, db.downtimes, async () => {
      for (const id of reportIds) {
        await db.pileWork.where('reportId').equals(id).delete();
        await db.drillings.where('reportId').equals(id).delete();
        await db.downtimes.where('reportId').equals(id).delete();
      }
      await db.reports.bulkDelete(reportIds);
    });

    return reportIds.length;
  }
}

// Singleton
export const outboxService = new OutboxService();
