import { CircuitBreaker } from '@/core/infrastructure/circuit-breakers';
import { cache } from '@/lib/redis-cache';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

/**
 * Скорость ветра на площадке.
 *
 * ЗАЧЕМ. Ветер — рабочее ограничение из руководства, а не погода за окном:
 * при 15 м/с работы прекращают, груз опускают и машину ставят на стоянку; при
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

/**
 * Условия на площадке целиком: ветер и температура.
 *
 * Температура добавлена для экрана оператора — он спрашивает не только ветер.
 * Отдельного запроса под неё нет: Open-Meteo отдаёт оба показателя одним
 * вызовом, и просить их порознь значило бы тратить вдвое больше обращений и
 * времени человека у машины.
 *
 * `temperatureC` может быть `null`: ветер — рабочее ограничение и нужен всегда,
 * температура — сведения, и её отсутствие не повод считать ответ негодным.
 */
export interface SiteConditions {
  windMs: number;
  temperatureC: number | null;
  /** Осадки, мм/ч. `null` — сервис не вернул. Отличают распутицу от сухой смены. */
  precipitationMmPerHour: number | null;
  /** Светло ли на площадке. `null` — неизвестно. */
  isDay: boolean | null;
  at: string;
}

/**
 * Пороги по ветру. Держим рядом с чтением, чтобы не разошлись.
 *
 * ОДИН ПОРОГ НА ПРОДУКТ. Раньше здесь стояло 20 м/с из руководств машин, а в
 * правилах смены (work-warnings) — 15 м/с. Оператор видел на карточке погоды
 * «в норме», а на соседнем экране красное «работы прекращают» по той же цифре.
 * Решение владельца 18.09.2026: порог прекращения работ — 15 м/с. Число
 * обязано совпадать с WIND_STOP_MS.
 */
export const WIND_STOP_WORK_MS = 15;
export const WIND_BOOM_TRANSPORT_MS = 36;

const CACHE_TTL_SECONDS = 15 * 60;
const REQUEST_TIMEOUT_MS = 3_000;

const weatherCircuitBreaker = new CircuitBreaker('weather', {
  failureThreshold: 3,
  resetTimeoutMs: 60_000,
  maxResetTimeoutMs: 600_000,
});

const apiBase = () => process.env.WEATHER_API_BASE?.replace(/\/$/, '') ?? 'https://api.open-meteo.com';

async function fetchConditions(latitude: number, longitude: number): Promise<SiteConditions | null> {
  const url = `${apiBase()}/v1/forecast?latitude=${latitude}&longitude=${longitude}`
    + '&current=wind_speed_10m,temperature_2m,precipitation,is_day&wind_speed_unit=ms';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`weather http ${response.status}`);
    const payload = (await response.json()) as {
      current?: {
        wind_speed_10m?: number;
        temperature_2m?: number;
        precipitation?: number;
        is_day?: number;
        time?: string;
      };
    };
    const windMs = payload.current?.wind_speed_10m;
    if (typeof windMs !== 'number' || !Number.isFinite(windMs)) return null;
    const temperature = payload.current?.temperature_2m;
    const precipitation = payload.current?.precipitation;
    const isDay = payload.current?.is_day;
    return {
      windMs: Math.round(windMs * 10) / 10,
      temperatureC: typeof temperature === 'number' && Number.isFinite(temperature)
        ? Math.round(temperature * 10) / 10
        : null,
      // Осадки и световой день добавлены для сезонных пунктов чек-листа
      // оператора. Как и температура, они необязательны: их отсутствие не
      // повод считать ответ негодным — ветер остаётся главным ограничением.
      precipitationMmPerHour: typeof precipitation === 'number' && Number.isFinite(precipitation)
        ? precipitation
        : null,
      isDay: typeof isDay === 'number' ? isDay === 1 : null,
      at: payload.current?.time ?? new Date().toISOString(),
    };
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

  const conditions = await getWeatherAt(site.latitude, site.longitude, `site:${tenantId}:${siteId}`);
  if (!conditions) return null;
  return { windMs: conditions.windMs, source: 'SERVICE', at: conditions.at };
}

/**
 * Условия в произвольной точке — для экрана оператора, где координаты приходят
 * с телефона, а не из карточки объекта.
 *
 * Ключ кэша по умолчанию считается от координат, ОКРУГЛЁННЫХ до сотых градуса
 * (примерно километр). Без округления у каждого нового замера GPS был бы свой
 * ключ, и кэш не срабатывал бы никогда — а именно ради него сюда и вынесен
 * общий клиент. Километр для прогноза по квадрату в несколько километров
 * разницы не делает.
 */
export async function getWeatherAt(
  latitude: number, longitude: number, cacheKey?: string,
): Promise<SiteConditions | null> {
  const key = cacheKey ?? `point:${latitude.toFixed(2)}:${longitude.toFixed(2)}`;
  try {
    return await cache.getOrSet(
      `weather:conditions:${key}`,
      () => weatherCircuitBreaker.execute(() => fetchConditions(latitude, longitude)),
      { ttl: CACHE_TTL_SECONDS },
    );
  } catch (error) {
    // Предохранитель открыт, таймаут, отказ сети — всё это не повод показывать
    // оператору ошибку. Он введёт ветер руками.
    logger.warn('Погода: сервис недоступен', {
      key, error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
