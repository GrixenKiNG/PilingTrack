'use client';

/**
 * Погода на площадке: температура и ветер там, где стоит машина.
 *
 * ТЕЛЕФОН ИЛИ API — ЭТО НЕ «ИЛИ». Телефон не знает погоду, он знает только
 * КООРДИНАТЫ. Погоду всегда отдаёт Gismeteo. Вопрос лишь в том, откуда взять
 * точку, и здесь их две, по убыванию точности:
 *
 *  1. GPS телефона (`navigator.geolocation`) — самое честное: машина может
 *     стоять в десятке километров от «центра объекта», а на кусте посреди поля
 *     ветер другой, чем в городе, по которому назван объект.
 *  2. Координаты объекта из карточки (`Site.latitude/longitude`) — когда
 *     оператор запретил геопозицию или GPS не ловит в кабине.
 *
 * Если нет ни того ни другого — блок говорит об этом словами и предлагает
 * разрешить доступ. Показывать погоду «примерно по области» нельзя: ветер
 * решает, поднимать ли мачту, и приблизительная цифра здесь опаснее её
 * отсутствия.
 *
 * Координаты НЕ СОХРАНЯЮТСЯ. Они уходят одним запросом за прогнозом и
 * забываются: следить за перемещениями оператора продукту незачем, а хранить
 * такое — заводить обязанность, которой сейчас нет.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '@/lib/api';
import { cn } from '@/lib/utils';

export interface Weather {
  temperature: number | null;
  windSpeed: number | null;
  /** Порог прекращения работ — 15 м/с, единый для продукта. */
  windWarning: boolean;
  /** Порог перевода стрелы в транспортное положение — 36 м/с. */
  windCritical: boolean;
}

type Origin = 'gps' | 'site';

type State =
  | { kind: 'working'; note: string }
  | { kind: 'ready'; weather: Weather; origin: Origin }
  | { kind: 'nowhere' }
  | { kind: 'failed'; message: string };

interface Props {
  /** Объект смены — источник запасных координат, когда GPS недоступен. */
  siteId: string | null;
  siteName: string | null;
  /**
   * Готовое чтение наверх: им отвечают на пункт «скорость ветра допустима»
   * в чек-листе площадки, до которого карточка уже не доживёт — она на
   * предыдущем шаге. null означает «погоды нет», и тогда пункт возвращается
   * человеку, а не подставляется «нормой».
   */
  onReading?: (reading: Weather | null) => void;
}

export function WeatherCard({ siteId, siteName, onReading }: Props) {
  const [state, setState] = useState<State>({ kind: 'working', note: 'Определяем, где вы…' });
  // Через ссылку, а не напрямую: обработчик из пропсов попал бы в зависимости
  // загрузки, и каждый рендер родителя перезапрашивал бы геопозицию.
  const report = useRef(onReading);
  useEffect(() => { report.current = onReading; }, [onReading]);

  const fetchWeather = useCallback(async (lat: number, lon: number, origin: Origin) => {
    setState({ kind: 'working', note: 'Смотрим погоду…' });
    try {
      const response = await authFetch(`/api/weather?lat=${lat}&lon=${lon}`);
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        report.current?.(null);
        return setState({ kind: 'failed', message: body?.error ?? 'Погода недоступна' });
      }
      report.current?.(body as Weather);
      setState({ kind: 'ready', weather: body as Weather, origin });
    } catch {
      report.current?.(null);
      setState({ kind: 'failed', message: 'Погода недоступна' });
    }
  }, []);

  /** Запасной путь: координаты объекта из его карточки. */
  const loadSiteWeather = useCallback(async () => {
    if (!siteId) return setState({ kind: 'nowhere' });
    try {
      const response = await authFetch(`/api/sites/${siteId}`);
      if (!response.ok) return setState({ kind: 'nowhere' });
      const { site } = await response.json();
      // Проверяем на null ДО Number(): `Number(null)` — это 0, а не NaN, и
      // объект без координат уехал бы в точку (0, 0) — Гвинейский залив.
      // Погода оттуда выглядит как настоящая, и поймать такое по экрану нельзя.
      if (site?.latitude == null || site?.longitude == null) return setState({ kind: 'nowhere' });
      const lat = Number(site.latitude);
      const lon = Number(site.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return setState({ kind: 'nowhere' });
      await fetchWeather(lat, lon, 'site');
    } catch {
      setState({ kind: 'nowhere' });
    }
  }, [siteId, fetchWeather]);

  const load = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return void loadSiteWeather();
    }
    setState({ kind: 'working', note: 'Определяем, где вы…' });
    navigator.geolocation.getCurrentPosition(
      (position) => void fetchWeather(position.coords.latitude, position.coords.longitude, 'gps'),
      // Отказ в геопозиции — не ошибка, а нормальный выбор человека. Молча
      // падать в «погода недоступна» нельзя: у нас есть второй источник.
      () => void loadSiteWeather(),
      // Смысл в погоде «здесь», поэтому кэш до пяти минут допустим, а точность
      // до метра не нужна: прогноз всё равно по квадрату в несколько км.
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }, [fetchWeather, loadSiteWeather]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- запрашивает геопозицию при монтировании
    load();
  }, [load]);

  if (state.kind === 'working') {
    return (
      <div className="rounded-xl border border-border bg-card px-3 py-2.5 text-base text-muted-foreground">
        {state.note}
      </div>
    );
  }

  if (state.kind === 'nowhere') {
    return (
      <div className="rounded-xl border border-border bg-card px-3 py-2.5">
        <p className="text-base text-muted-foreground">
          Погоды нет: телефон не дал геопозицию
          {siteName ? `, а у объекта «${siteName}» не заданы координаты` : ''}
        </p>
        <button type="button" onClick={load} className="mt-1 text-base font-medium text-signal-strong">
          Разрешить геопозицию и обновить
        </button>
      </div>
    );
  }

  if (state.kind === 'failed') {
    return (
      <div className="rounded-xl border border-border bg-card px-3 py-2.5">
        <p className="text-base text-muted-foreground">{state.message}</p>
        <button type="button" onClick={load} className="mt-1 text-base font-medium text-signal-strong">
          Повторить
        </button>
      </div>
    );
  }

  const { weather, origin } = state;
  return (
    <div className={cn('rounded-xl border px-3 py-2.5',
      weather.windCritical ? 'border-destructive/50 bg-destructive/10'
        : weather.windWarning ? 'border-warning/50 bg-warning/10'
          : 'border-border bg-card')}>
      <div className="flex items-baseline justify-between gap-3">
        {/* Объект в заголовке, а не только в подписи об источнике: у оператора
            может быть закреплено несколько машин на разных объектах, и «погода
            на площадке» без имени площадки — утверждение ни о чём. */}
        <span className="min-w-0 text-sm text-muted-foreground">
          Погода{siteName ? <> · <span className="text-foreground">{siteName}</span></> : ' на площадке'}
        </span>
        {weather.temperature != null && (
          <span className="text-2xl font-bold tabular-nums text-foreground">
            {Math.round(weather.temperature)} °C
          </span>
        )}
      </div>
      {weather.windSpeed != null && (
        <p className="mt-0.5 text-base text-foreground">
          Ветер {weather.windSpeed} м/с
        </p>
      )}
      {/* Источник точки называем вслух: «по объекту» может отличаться от места
          работы на десятки километров, и человек должен знать, насколько
          цифре верить. */}
      <p className="mt-1 text-sm text-muted-foreground">
        {/* Источник точки называем вслух: по телефону это место, где человек
            стоит на самом деле, по объекту — точка из карточки, которая может
            отличаться от куста на десятки километров. */}
        {origin === 'gps' ? 'по геопозиции телефона' : 'по координатам объекта из карточки'}
      </p>
      {/* Формулировки — из руководств машин, а не «сильный ветер». Оператор
          должен понять, что именно от него требуется, а не оценивать погоду. */}
      {weather.windCritical ? (
        <p className="mt-1.5 text-base font-semibold text-destructive-strong">
          Ветер 36 м/с и выше — стрелу переводят в транспортное положение.
          Решение принимает мастер на месте
        </p>
      ) : weather.windWarning ? (
        <p className="mt-1.5 text-base font-semibold text-warning-strong">
          Ветер 15 м/с и выше — работы прекращают, груз опускают, машину на стоянку.
          Решение принимает мастер на месте
        </p>
      ) : null}
    </div>
  );
}
