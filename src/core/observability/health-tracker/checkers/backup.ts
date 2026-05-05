import { promises as fs } from 'fs';
import path from 'path';
import { getRedisClient } from '@/lib/redis-cache';
import {
  BACKUP_CRITICAL_HOURS,
  BACKUP_STALE_HOURS,
  DEFAULT_BACKUP_DIR,
} from '../thresholds';
import type { BackupHealth } from '../types';

function isBackupMonitoringEnabled(): boolean {
  const raw = process.env.BACKUP_ENABLED?.trim().toLowerCase();
  if (!raw) return false;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function getBackupDir(): string {
  return process.env.BACKUP_DIR || DEFAULT_BACKUP_DIR;
}

async function readBackupFromFilesystem(): Promise<BackupHealth | null> {
  try {
    const dailyDir = path.join(getBackupDir(), 'daily');
    const files = await fs.readdir(dailyDir);
    const dumpFiles = files.filter((file) => file.endsWith('.dump')).sort().reverse();

    if (dumpFiles.length === 0) {
      return null;
    }

    const latestPath = path.join(dailyDir, dumpFiles[0]);
    const stats = await fs.stat(latestPath);
    const ageMs = Date.now() - stats.mtime.getTime();
    const ageHours = Math.round((ageMs / (1000 * 60 * 60)) * 10) / 10;
    const lastBackupAt = stats.mtime.toISOString();
    const sizeMb = Math.max(stats.size / (1024 * 1024), 0.01);
    const lastBackupSize = `${sizeMb.toFixed(2)} MB`;

    if (ageHours > BACKUP_CRITICAL_HOURS) {
      return {
        status: 'down',
        lastBackupAt,
        lastBackupAgeHours: ageHours,
        lastBackupSize,
        source: 'filesystem',
      };
    }

    if (ageHours > BACKUP_STALE_HOURS) {
      return {
        status: 'slow',
        lastBackupAt,
        lastBackupAgeHours: ageHours,
        lastBackupSize,
        source: 'filesystem',
      };
    }

    return {
      status: 'up',
      lastBackupAt,
      lastBackupAgeHours: ageHours,
      lastBackupSize,
      source: 'filesystem',
    };
  } catch {
    return null;
  }
}

export async function checkBackupStatus(): Promise<BackupHealth> {
  if (!isBackupMonitoringEnabled()) {
    return { status: 'up', source: 'disabled' };
  }

  try {
    const client = await getRedisClient();
    if (!client) {
      const fallback = await readBackupFromFilesystem();
      return fallback || { status: 'slow', source: 'missing' };
    }

    const lastBackupAt = await client.get('system:backup:last_timestamp');
    const lastBackupSize = await client.get('system:backup:last_size');
    const s3Synced = await client.get('system:backup:s3_synced');

    if (!lastBackupAt) {
      const fallback = await readBackupFromFilesystem();
      if (fallback) {
        return fallback;
      }
      return { status: 'slow', source: 'missing' };
    }

    const backupTime = new Date(lastBackupAt).getTime();
    const ageMs = Date.now() - backupTime;
    const ageHours = Math.round((ageMs / (1000 * 60 * 60)) * 10) / 10;

    if (ageHours > BACKUP_CRITICAL_HOURS) {
      return {
        status: 'down',
        lastBackupAt,
        lastBackupAgeHours: ageHours,
        lastBackupSize: lastBackupSize || undefined,
        s3Synced: s3Synced === 'true',
        source: 'redis',
      };
    }

    if (ageHours > BACKUP_STALE_HOURS) {
      return {
        status: 'slow',
        lastBackupAt,
        lastBackupAgeHours: ageHours,
        lastBackupSize: lastBackupSize || undefined,
        s3Synced: s3Synced === 'true',
        source: 'redis',
      };
    }

    return {
      status: 'up',
      lastBackupAt,
      lastBackupAgeHours: ageHours,
      lastBackupSize: lastBackupSize || undefined,
      s3Synced: s3Synced === 'true',
      source: 'redis',
    };
  } catch {
    const fallback = await readBackupFromFilesystem();
    return fallback || { status: 'slow', source: 'missing' };
  }
}
