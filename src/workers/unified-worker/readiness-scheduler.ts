/**
 * Тик техготовности: истечение нарядов-допусков и автозакрытие несданных
 * смен. Раз в час и вскоре после запуска.
 *
 * Раз в час, а не в сутки: суточный тик срабатывал в час, заданный моментом
 * запуска контейнера, и правило «закрывать смену с полудня следующих суток»
 * исполнялось когда придётся — вплоть до суток опоздания.
 *
 * Идемпотентен по построению (см. runReadinessScheduler), поэтому выбора
 * лидера не требует: двойной прогон ничего не задваивает, а суточный пересчёт
 * готовности дедуплицируется по дате.
 */

import { logger } from '@/lib/logger';
import { forEachTenant } from '@/lib/tenant-iteration';
import { runReadinessScheduler } from '@/modules/readiness/application/scheduler';

const INTERVAL = parseInt(process.env.READINESS_SCHEDULER_INTERVAL_MS || String(60 * 60 * 1000), 10);
const STARTUP_DELAY = parseInt(process.env.READINESS_SCHEDULER_STARTUP_DELAY_MS || '90000', 10);

async function runOnce(): Promise<void> {
  try {
    // Перечень организаций берётся из таблицы Tenant, а не из Shift.
    // Politики RLS на Shift строгие: запрос без объявленной организации
    // возвращает ноль строк, и планировщик молча не делал бы ничего.
    // forEachTenant заводит контекст на каждую организацию отдельно.
    await forEachTenant(async (tenantId) => {
      const result = await runReadinessScheduler(tenantId);
      if (result.permitsExpired > 0 || result.shiftsAutoClosed > 0) {
        logger.info('Readiness scheduler pass', {
          tenantId,
          permitsExpired: result.permitsExpired,
          shiftsAutoClosed: result.shiftsAutoClosed,
        });
      }
    });
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
