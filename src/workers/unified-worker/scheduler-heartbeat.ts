/**
 * Пульс планировщиков (F-SCHEDULER-HEARTBEAT).
 *
 * Суточные и часовые планировщики живут только в контейнере `workers` и до сих
 * пор не оставляли следа: остановка контейнера означала тихое прекращение всей
 * суточной рутины (автозакрытие смен, истечение нарядов-допусков, план ТО,
 * пересборка витрин), которое не видно ни `/api/health`, ни метрикам (R59 #1, #2).
 *
 * После каждого успешного прохода планировщик пишет сюда ISO-время в инстанс
 * СОСТОЯНИЯ Redis — не в кэш: вытесненная запись читалась бы как «задача не
 * идёт» (та же ловушка двух Redis, что и с пульсом служб, см. getStateRedisClient).
 * TTL — три интервала самого планировщика: если проходы прекратились, ключ
 * истекает и отсутствие свежего пульса становится видимым.
 *
 * Запись — вспомогательная: её сбой не должен ломать прогон планировщика.
 *
 * Формат ключа и список имён — в core (`health-tracker/scheduler-registry`):
 * по нему читает пульс health-tracker, и core не имеет права зависеть от workers
 * (scripts/check-layer-boundaries.ts), поэтому общий источник живёт там.
 */

import { SCHEDULER_HEARTBEAT_PREFIX } from '@/core/observability/health-tracker/scheduler-registry';
import { getStateRedisClient } from '@/lib/redis-cache';
import { logger } from '@/lib/logger';

/** Префикс ключей пульса. Планировщики дописывают к нему своё имя. */
export { SCHEDULER_HEARTBEAT_PREFIX };

/**
 * Отметить успешный проход планировщика.
 *
 * @param name       имя планировщика (совпадает с тегом задачи в Sentry)
 * @param intervalMs интервал проходов; TTL = три интервала
 */
export async function recordSchedulerHeartbeat(name: string, intervalMs: number): Promise<void> {
  try {
    const client = await getStateRedisClient();
    if (!client) return;

    const ttlSeconds = Math.max(1, Math.round((intervalMs * 3) / 1000));
    await client.set(`${SCHEDULER_HEARTBEAT_PREFIX}${name}`, new Date().toISOString(), 'EX', ttlSeconds);
  } catch (error) {
    // Redis может быть недоступен — это не повод считать прогон неудачным.
    logger.warn('Failed to record scheduler heartbeat', {
      scheduler: name,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
