import { withTimeout } from '../helpers';
import { DB_CHECK_TIMEOUT_MS } from '../thresholds';
import type { StorageHealth, StorageProvider } from '../types';

export function getStorageProvider(): StorageProvider {
  if (process.env.S3_BUCKET || process.env.S3_ACCESS_KEY_ID) {
    return 's3';
  }
  return 'local';
}

export async function checkStorage(): Promise<StorageHealth> {
  const provider = getStorageProvider();

  if (provider === 'local') {
    return { status: 'up', provider: 'local' };
  }

  try {
    const { getS3ClientForHealth } = await import('../../s3-health-check');
    const ok = await withTimeout(getS3ClientForHealth(), DB_CHECK_TIMEOUT_MS, 'S3 health');

    return {
      status: ok ? 'up' : 'down',
      provider: 's3',
    };
  } catch {
    return { status: 'down', provider: 's3' };
  }
}
