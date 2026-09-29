import { STORAGE_CHECK_TIMEOUT_MS } from '../thresholds';
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

  // Таймаут отменяет сам HTTP-запрос (abortSignal в send), а не только
  // отклоняет промис: иначе при тормозящем R2 каждые 15 с копились бы
  // висящие запросы с ретраями SDK.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STORAGE_CHECK_TIMEOUT_MS);

  try {
    const { getS3ClientForHealth } = await import('../../s3-health-check');
    const ok = await getS3ClientForHealth(controller.signal);

    return {
      status: ok ? 'up' : 'down',
      provider: 's3',
    };
  } catch {
    // Медленно, но не упало: запрос не успел за порог. Явная ошибка S3
    // (исключение не по таймауту или ok=false) остаётся 'down'.
    return { status: controller.signal.aborted ? 'degraded' : 'down', provider: 's3' };
  } finally {
    clearTimeout(timer);
  }
}
