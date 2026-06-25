/**
 * PM scheduler tick (P3). Once a day (and shortly after startup) it runs the
 * maintenance-plan evaluation for every tenant that has plans, creating PLANNED
 * work orders for rigs that are due. Idempotent (dedup by open work order), so
 * it needs no leader election — a double run can't create duplicates.
 */

import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { runPmScheduler } from '@/modules/equipment';

const PM_INTERVAL = parseInt(process.env.PM_SCHEDULER_INTERVAL_MS || String(24 * 60 * 60 * 1000), 10);
const PM_STARTUP_DELAY = parseInt(process.env.PM_SCHEDULER_STARTUP_DELAY_MS || '60000', 10);

async function runOnce(): Promise<void> {
  try {
    const tenants = await db.maintenancePlan.findMany({
      where: { isActive: true },
      distinct: ['tenantId'],
      select: { tenantId: true },
    });
    for (const { tenantId } of tenants) {
      const result = await runPmScheduler(tenantId);
      if (result.created > 0 || result.due > 0) {
        logger.info('PM scheduler pass', { tenantId, ...result });
      }
    }
  } catch (error) {
    logger.error('PM scheduler pass failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Start the daily PM tick. Returns a stop fn that clears the timers. */
export function startPmScheduler(): () => void {
  logger.info('Arming PM scheduler', { intervalMs: PM_INTERVAL });
  const startupTimer = setTimeout(() => void runOnce(), PM_STARTUP_DELAY);
  const interval = setInterval(() => void runOnce(), PM_INTERVAL);
  return () => {
    clearTimeout(startupTimer);
    clearInterval(interval);
  };
}
