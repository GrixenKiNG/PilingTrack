import { db } from '@/lib/db';

/**
 * Update device sync state after a sync operation.
 * - On success: updates lastSyncAt, syncStatus, changesSent, changesRecv, lastVectorClock
 * - On error: updates lastError, syncStatus = 'failed'
 */
export async function updateDeviceSyncState(
  deviceId: string,
  tenantId: string,
  userId: string | undefined,
  options:
    | {
        success: true;
        changesSent: number;
        changesRecv: number;
        lastVectorClock?: Record<string, number>;
      }
    | {
        success: false;
        error: string;
      }
): Promise<void> {
  const now = new Date();

  if (options.success) {
    await db.deviceSyncState.upsert({
      where: { deviceId },
      update: {
        lastSyncAt: now,
        syncStatus: 'idle',
        changesSent: { increment: options.changesSent },
        changesRecv: { increment: options.changesRecv },
        lastError: null,
        ...(options.lastVectorClock ? { lastVectorClock: options.lastVectorClock } : {}),
      },
      create: {
        deviceId,
        tenantId,
        userId: userId || null,
        lastSyncAt: now,
        syncStatus: 'idle',
        changesSent: options.changesSent,
        changesRecv: options.changesRecv,
        ...(options.lastVectorClock ? { lastVectorClock: options.lastVectorClock } : {}),
      },
    });
  } else {
    await db.deviceSyncState.upsert({
      where: { deviceId },
      update: {
        lastSyncAt: now,
        syncStatus: 'failed',
        lastError: options.error,
      },
      create: {
        deviceId,
        tenantId,
        userId: userId || null,
        lastSyncAt: now,
        syncStatus: 'failed',
        lastError: options.error,
        changesSent: 0,
        changesRecv: 0,
      },
    });
  }
}

/**
 * Get or create device sync state at the beginning of a sync.
 * Sets syncStatus to 'syncing' to indicate an in-progress sync.
 */
export async function initDeviceSyncState(
  deviceId: string,
  tenantId: string,
  userId: string | undefined
): Promise<void> {
  await db.deviceSyncState.upsert({
    where: { deviceId },
    update: {
      syncStatus: 'syncing',
      lastError: null,
    },
    create: {
      deviceId,
      tenantId,
      userId: userId || null,
      syncStatus: 'syncing',
    },
  });
}

export async function getDeviceSyncStatus(deviceId: string): Promise<{
  id: string;
  deviceId: string;
  tenantId: string | null;
  userId: string | null;
  lastSyncAt: Date;
  syncStatus: string;
  lastError: string | null;
  changesSent: number;
  changesRecv: number;
  lastVectorClock: unknown;
  createdAt: Date;
  updatedAt: Date;
} | null> {
  const state = await db.deviceSyncState.findUnique({
    where: { deviceId },
  });

  if (!state) return null;
  return state;
}

/**
 * Get all device sync states for a tenant (admin use).
 */
export async function getTenantDeviceSyncStates(tenantId: string) {
  return db.deviceSyncState.findMany({
    where: { tenantId },
    orderBy: { lastSyncAt: 'desc' },
  });
}
