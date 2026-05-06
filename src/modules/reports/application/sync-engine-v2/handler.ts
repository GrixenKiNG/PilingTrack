import { logger } from '@/lib/logger';
import type {
  Conflict,
  ServerChange,
  SyncRequest,
  SyncResponse,
} from '@/core/shared/types/sync';
import { initDeviceSyncState, updateDeviceSyncState } from './device-state';
import { processReportChange } from './report-processor';
import { getServerChanges } from './server-changes';

export async function handleSync(request: SyncRequest): Promise<SyncResponse> {
  const { deviceId, tenantId, userId, lastSyncAt, changes } = request;

  const conflicts: Conflict[] = [];
  const serverChanges: ServerChange[] = [];
  let applied = 0;
  let skipped = 0;

  await initDeviceSyncState(deviceId, tenantId, userId);

  try {
    // Process client changes
    for (const change of changes) {
      try {
        const result = await processReportChange(change, tenantId);

        if (!result.applied) {
          skipped++;
        } else {
          applied++;
          if (result.conflict) {
            conflicts.push(result.conflict);
          }
        }
      } catch (err) {
        // Log error but continue processing other changes
        logger.error('Sync: error processing change', err, { opId: change.opId });
      }
    }

    // Pull server changes
    const serverUpdates = await getServerChanges(tenantId, lastSyncAt);
    serverChanges.push(...serverUpdates);

    const newSyncAt = new Date().toISOString();

    // Collect the last known vector clock from processed changes
    const lastVC =
      changes.length > 0
        ? (changes[changes.length - 1].vectorClock as Record<string, number> | undefined)
        : undefined;

    await updateDeviceSyncState(deviceId, tenantId, userId, {
      success: true,
      changesSent: applied,
      changesRecv: serverUpdates.length,
      lastVectorClock: lastVC,
    });

    return {
      serverChanges,
      conflicts,
      newSyncAt,
      syncStatus: 'idle',
      stats: { applied, conflicts: conflicts.length, skipped },
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown sync error';

    await updateDeviceSyncState(deviceId, tenantId, userId, {
      success: false,
      error: errorMessage,
    });

    throw err;
  }
}
