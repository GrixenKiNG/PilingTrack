import { getStateRedisClient } from '@/lib/redis-cache';
import { SCHEDULER_HEARTBEAT_PREFIX, SCHEDULER_NAMES } from '../scheduler-registry';
import type { SchedulerHealth } from '../types';

/**
 * Пульс планировщиков контейнера `workers` (F-HEALTH-SCHEDULERS).
 *
 * Планировщики пишут `system:scheduler:<имя>` в инстанс СОСТОЯНИЯ Redis с TTL
 * в три своих интервала: пропавший ключ и есть «проходы прекратились».
 *
 * Отсутствие данных (нет клиента или ошибка чтения) тоже считаем `stale`, а не
 * `ok`: иначе недоступность инстанса состояния выглядела бы как благополучие —
 * ровно тот ложнозелёный ответ, ради которого проверка и заведена. Планировщики
 * не бросают исключение: их остановка не должна ронять саму проверку здоровья.
 */
export async function checkSchedulers(): Promise<SchedulerHealth> {
  try {
    const client = await getStateRedisClient();
    if (!client) {
      return { status: 'stale', stale: [...SCHEDULER_NAMES] };
    }

    const stale: string[] = [];
    for (const name of SCHEDULER_NAMES) {
      const heartbeat = await client.get(`${SCHEDULER_HEARTBEAT_PREFIX}${name}`);
      if (!heartbeat) {
        stale.push(name);
      }
    }

    return stale.length > 0 ? { status: 'stale', stale } : { status: 'ok', stale: [] };
  } catch {
    return { status: 'stale', stale: [...SCHEDULER_NAMES] };
  }
}
