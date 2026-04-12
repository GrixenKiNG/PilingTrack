/**
 * S3 Health Check — Lightweight S3 Connectivity Probe
 *
 * Used by the health tracker to verify S3 is reachable.
 * Performs a cheap ListObjectsV2 with maxKeys=1 (no data transfer).
 */

import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { logger } from '@/lib/logger';

let _healthCheckClient: S3Client | null = null;

function getHealthCheckS3Client(): S3Client | null {
  if (!process.env.S3_BUCKET || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) {
    return null;
  }

  if (!_healthCheckClient) {
    _healthCheckClient = new S3Client({
      region: process.env.S3_REGION || 'auto',
      endpoint: process.env.S3_ENDPOINT,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      },
      forcePathStyle: !!process.env.S3_ENDPOINT,
    });
  }

  return _healthCheckClient;
}

/**
 * Probe S3 connectivity with a cheap ListObjectsV2 call.
 * Returns true if S3 is reachable.
 */
export async function getS3ClientForHealth(): Promise<boolean> {
  const s3 = getHealthCheckS3Client();
  if (!s3) return false;

  try {
    await s3.send(new ListObjectsV2Command({
      Bucket: process.env.S3_BUCKET!,
      MaxKeys: 1,
    }));
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // NoSuchBucket is still "reachable" — bucket config issue, not connectivity
    if (msg.includes('NoSuchBucket')) {
      logger.warn('S3 health check: bucket not found', { bucket: process.env.S3_BUCKET });
      return false;
    }
    logger.debug('S3 health check failed', { error: msg });
    return false;
  }
}
