import { getStateRedisClient } from '@/lib/redis-cache';
import { SCHEDULER_HEARTBEAT_PREFIX, enabledSchedulerNames } from '../scheduler-registry';
import type { SchedulerHealth } from '../types';

/**
 * Пульс планировщиков контейнера `workers` (F-HEALTH-SCHEDULERS).
 *
 * Планировщики пишут `system:scheduler:<имя>` в инстанс СОСТОЯНИЯ Redis с TTL
 * в три своих интервала: пропавший ключ и есть «проходы прекратились».
 *
 * Спрашиваем пульс только у ВКЛЮЧЁННЫХ планировщиков
 * (`enabledSchedulerNames`, F-IDEMP-CLEANUP-OPTIN): выключенный планировщик
 * пульса не пишет никогда, и требование его ключа навсегда оставило бы
 * `/api/health/deep` в `degraded` со `staleSchedulers` — настоящая остановка
 * утонула бы в постоянном шуме.
 *
 * Отсутствие данных (нет клиента или ошибка чтения) тоже считаем `stale`, а не
 * `ok`: иначе недоступность инстанса состояния выглядела бы как благополучие —
 * ровно тот ложнозелёный ответ, ради которого проверка и заведена. Планировщики
 * не бросают исключение: их остановка не должна ронять саму проверку здоровья.
 */
export async function checkSchedulers(): Promise<SchedulerHealth> {
  const required = enabledSchedulerNames();
  if (required.length === 0) return { status: 'ok', stale: [] };
  try {
    const client = await getStateRedisClient();
    if (!client) {
      return { status: 'stale', stale: [...required] };
    }

    const stale: string[] = [];
    for (const name of required) {
      const heartbeat = await client.get(`${SCHEDULER_HEARTBEAT_PREFIX}${name}`);
      if (!heartbeat) {
        stale.push(name);
      }
    }

    return stale.length > 0 ? { status: 'stale', stale } : { status: 'ok', stale: [] };
  } catch {
    return { status: 'stale', stale: [...required] };
  }
}
