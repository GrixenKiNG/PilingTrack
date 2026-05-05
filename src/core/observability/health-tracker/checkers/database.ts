import { getDbClient, withTimeout } from '../helpers';
import { DB_CHECK_TIMEOUT_MS, DB_SLOW_THRESHOLD_MS } from '../thresholds';
import type { ComponentHealth } from '../types';

export async function checkDatabase(): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    const db = await getDbClient();
    await withTimeout(db.$queryRaw`SELECT 1`, DB_CHECK_TIMEOUT_MS, 'Database');
    const latency = Date.now() - start;

    return {
      status: latency > DB_SLOW_THRESHOLD_MS ? 'slow' : 'up',
      latencyMs: latency,
    };
  } catch {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
    };
  }
}
