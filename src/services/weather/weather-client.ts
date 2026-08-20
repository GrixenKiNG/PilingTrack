import { CircuitBreaker } from '@/core/infrastructure/circuit-breakers';
import { cache } from '@/lib/redis-cache';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

/**
 * Скорость ветра на площадке.
 *
 * ЗАЧЕМ. Ветер — рабочее ограничение из руководства, а не погода за окном:
 * при 20 м/с работы прекращают, груз опускают и машину ставят на стоянку; при
 * прогнозе свыше 36 м/с стрелу переводят в транспортное положение (Liebherr
 * LB 20 / LRH 100, таблицы грузоподъёмности). Оператор должен видеть цифру, не
 * выходя из приложения.
 *
 * ПОЧЕМУ Open-Meteo. Без ключа и регистрации, отдаёт текущий ветер по
 * координатам. Адрес вынесен в `WEATHER_API_BASE` по образцу `TELEGRAM_API_BASE`:
 * `api.telegram.org` с этого VPS уже недоступен из-за провайдера и работает
 * через прокси. Если погодный сервис окажется в том же положении, замена
 * адреса решит дело без правки кода.
 *
 * НИКОГДА НЕ БРОСАЕТ. Ветер не блокирует ни пуск смены, ни работу: нет
 * координат, нет сети, открыт предохранитель — возвращается `null`, и экран
 * показывает поле ручного ввода. Погодный сервис не должен уметь остановить
 * работу на площадке.
 */
export interface WindReading {
  windMs: number;
  source: 'SERVICE';
  at: string;
}

/** Пороги из руководства. Держим рядом с чтением, чтобы не разошлись. */
export const WIND_STOP_WORK_MS = 20;
export const WIND_BOOM_TRANSPORT_MS = 36;

const CACHE_TTL_SECONDS = 15 * 60;
const REQUEST_TIMEOUT_MS = 3_000;

const weatherCircuitBreaker = new CircuitBreaker('weather', {
  failureThreshold: 3,
  resetTimeoutMs: 60_000,
  maxResetTimeoutMs: 600_000,
});

const apiBase = () => process.env.WEATHER_API_BASE?.replace(/\/$/, '') ?? 'https://api.open-meteo.com';

async function fetchWind(latitude: number, longitude: number): Promise<WindReading | null> {
  const url = `${apiBase()}/v1/forecast?latitude=${latitude}&longitude=${longitude}`
    + '&current=wind_speed_10m&wind_speed_unit=ms';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`weather http ${response.status}`);
    const payload = (await response.json()) as { current?: { wind_speed_10m?: number; time?: string } };
    const windMs = payload.current?.wind_speed_10m;
    if (typeof windMs !== 'number' || !Number.isFinite(windMs)) return null;
    return { windMs: Math.round(windMs * 10) / 10, source: 'SERVICE', at: payload.current?.time ?? new Date().toISOString() };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ветер на объекте. `null` — координат нет либо сервис недоступен.
 *
 * Объект читается строго в пределах организации: чужую площадку сюда не
 * подставить даже верным идентификатором.
 */
export async function getSiteWind(tenantId: string, siteId: string): Promise<WindReading | null> {
  if (!tenantId) throw new Error('tenantId is required');

  const site = await db.site.findFirst({
    where: { id: siteId, tenantId },
    select: { latitude: true, longitude: true },
  });
  // Нет координат — наружу не ходим вовсе: лишний запрос ради заведомого
  // промаха только тратит квоту и время оператора.
  if (site?.latitude == null || site?.longitude == null) return null;
  const { latitude, longitude } = site;

  try {
    return await cache.getOrSet(
      `weather:wind:${tenantId}:${siteId}`,
      () => weatherCircuitBreaker.execute(() => fetchWind(latitude, longitude)),
      { ttl: CACHE_TTL_SECONDS },
    );
  } catch (error) {
    // Предохранитель открыт, таймаут, отказ сети — всё это не повод показывать
    // оператору ошибку. Он введёт ветер руками.
    logger.warn('Ветер: сервис недоступен, показываем ручной ввод', {
      siteId, error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
