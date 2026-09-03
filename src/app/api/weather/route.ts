import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withApi } from '@/core/api-wrapper';
import {
  WIND_BOOM_TRANSPORT_MS, WIND_STOP_WORK_MS, getWeatherAt,
} from '@/services/weather/weather-client';

export const runtime = 'nodejs';

/**
 * Погода на точке работ — ветер и температура по координатам.
 *
 * ПОЧЕМУ НЕ GISMETEO. Сначала здесь был он, и это оказалось лишним: в продукте
 * уже был `services/weather/weather-client` на Open-Meteo — без ключа, с кэшем
 * в Redis на 15 минут, предохранителем на отказы и порогами ветра, выписанными
 * из руководств машин (Liebherr LB 20 / LRH 100): 20 м/с — работы прекращают,
 * 36 м/с — стрелу в транспортное положение. Отдельный клиент рядом означал бы
 * второй ответ на тот же вопрос: свой кэш, свои пороги, ещё один секрет в
 * окружении. Маршрут стал тонкой обёрткой над общим клиентом.
 *
 * ПОЧЕМУ ЧЕРЕЗ СЕРВЕР, А НЕ ИЗ БРАУЗЕРА. Кэш и предохранитель живут на сервере:
 * из клиента каждый телефон ходил бы наружу сам, и при недоступности сервиса
 * каждый ждал бы таймаут в одиночку. Заодно это снимает вопрос с CSP — строгая
 * политика продукта не пускает страницу на чужие хосты.
 *
 * Координаты приходят от телефона оператора (`navigator.geolocation`) либо из
 * карточки объекта — то есть погода привязана к месту, где стоит машина.
 */

/** То, что нужно экрану оператора. */
export interface OperatorWeather {
  temperature: number | null;
  windSpeed: number | null;
  /** Ветер достиг порога прекращения работ. */
  windWarning: boolean;
  /** Ветер достиг порога перевода стрелы в транспортное положение. */
  windCritical: boolean;
}

export const GET = withApi(
  async (request: NextRequest) => {
    const { error } = await requireAuth(request);
    if (error) return error;

    const latitude = Number(request.nextUrl.searchParams.get('lat'));
    const longitude = Number(request.nextUrl.searchParams.get('lon'));
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
      || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      return NextResponse.json({ error: 'Некорректные координаты' }, { status: 400 });
    }

    const conditions = await getWeatherAt(latitude, longitude);
    if (!conditions) {
      // Клиент никогда не бросает: `null` — это «сервис не ответил». Погодный
      // сервис не должен уметь остановить работу на площадке, поэтому здесь не
      // ошибка приложения, а честное «сейчас неизвестно».
      return NextResponse.json({ error: 'Погода сейчас недоступна' }, { status: 503 });
    }

    const result: OperatorWeather = {
      temperature: conditions.temperatureC,
      windSpeed: conditions.windMs,
      windWarning: conditions.windMs >= WIND_STOP_WORK_MS,
      windCritical: conditions.windMs >= WIND_BOOM_TRANSPORT_MS,
    };
    return NextResponse.json(result);
  },
  { domain: 'operator.weather' },
);
