/**
 * Суточный тик техготовности: истечение нарядов-допусков и автозакрытие
 * несданных смен. Раз в сутки и вскоре после запуска, как PM-планировщик.
 *
 * Идемпотентен по построению (см. runReadinessScheduler), поэтому выбора
 * лидера не требует: двойной прогон ничего не задваивает.
 */

import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { runReadinessScheduler } from '@/modules/readiness/application/scheduler';

const INTERVAL = parseInt(process.env.READINESS_SCHEDULER_INTERVAL_MS || String(24 * 60 * 60 * 1000), 10);
const STARTUP_DELAY = parseInt(process.env.READINESS_SCHEDULER_STARTUP_DELAY_MS || '90000', 10);

async function runOnce(): Promise<void> {
  try {
    // Тенанты берём по сменам: там, где смен нет, закрывать и просрочивать
    // нечего.
    const tenants = await db.shift.findMany({ distinct: ['tenantId'], select: { tenantId: true } });
    for (const { tenantId } of tenants) {
      const result = await runReadinessScheduler(tenantId);
      if (result.permitsExpired > 0 || result.shiftsAutoClosed > 0) {
        logger.info('Readiness scheduler pass', {
          tenantId,
          permitsExpired: result.permitsExpired,
          shiftsAutoClosed: result.shiftsAutoClosed,
        });
      }
    }
  } catch (error) {
    logger.error('Readiness scheduler pass failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Запускает суточный тик. Возвращает функцию остановки. */
export function startReadinessScheduler(): () => void {
  logger.info('Arming readiness scheduler', { intervalMs: INTERVAL });
  const startupTimer = setTimeout(() => void runOnce(), STARTUP_DELAY);
  const interval = setInterval(() => void runOnce(), INTERVAL);
  return () => {
    clearTimeout(startupTimer);
    clearInterval(interval);
  };
}
