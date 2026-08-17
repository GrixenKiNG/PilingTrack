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

/**
 * Оповещение о просроченном ТО.
 *
 * Правило «Просроченные ТО» жило в настройках без отправителя: переключатель
 * сохранялся, слать было некому. Данные при этом считались ежедневно прямо
 * здесь — не хватало только сообщения.
 *
 * Одно сводное сообщение на тенант за прогон, а не письмо на каждый регламент:
 * прогон суточный, и десять просрочек не должны превращаться в десять
 * уведомлений.
 */
async function notifyOverdue(
  tenantId: string,
  overdue: Awaited<ReturnType<typeof runPmScheduler>>['overdue'],
): Promise<void> {
  if (overdue.length === 0) return;
  try {
    const { isNotificationEnabled } = await import('@/modules/settings');
    if (!await isNotificationEnabled(tenantId, 'maintenanceOverdue')) return;

    const names = new Map((await db.equipment.findMany({
      where: { tenantId, id: { in: overdue.map((item) => item.equipmentId) } },
      select: { id: true, name: true },
    })).map((row) => [row.id, row.name]));

    const lines = overdue.slice(0, 10).map((item) => {
      const machine = names.get(item.equipmentId) ?? 'Установка вне справочника';
      const by = item.hoursOverdue != null
        ? `перепробег ${Math.round(item.hoursOverdue)} м/ч`
        : item.daysOverdue != null ? `просрочено на ${Math.round(item.daysOverdue)} дн.` : 'срок нарушен';
      return `• ${machine} — ${item.title} (${by})`;
    });
    if (overdue.length > lines.length) lines.push(`…и ещё ${overdue.length - lines.length}`);

    const { telegramNotifier } = await import('@/core/notifications/telegram');
    await telegramNotifier.sendAlert({
      severity: overdue.length > 3 ? 'high' : 'medium',
      message: `Просрочено регламентов ТО: ${overdue.length}\n${lines.join('\n')}`,
    });
  } catch (error) {
    // Оповещение не должно ронять суточный прогон планировщика.
    logger.error('PM overdue alert failed', {
      tenantId, error: error instanceof Error ? error.message : String(error),
    });
  }
}

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
        logger.info('PM scheduler pass', { tenantId, created: result.created, due: result.due });
      }
      await notifyOverdue(tenantId, result.overdue);
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
