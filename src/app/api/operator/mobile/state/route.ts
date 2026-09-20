import {NextRequest, NextResponse} from 'next/server';
import {withApi} from '@/core/api-wrapper';
import {requireAuth} from '@/lib/auth';
import {queryOperatorMobileState} from '@/modules/operator-mobile';
import {getWeatherAt} from '@/services/weather/weather-client';

export const runtime = 'nodejs';

/**
 * Состояние мобильного места оператора целиком.
 *
 * Координаты приходят от телефона (`navigator.geolocation`). Их нет — берём
 * координаты объекта. Нет и их — экран работает без погоды, а сезонные пункты
 * чек-листа не добавляются: выдумывать погоду хуже, чем её не знать.
 */
export const GET = withApi(
  async (request: NextRequest) => {
    const {user, error} = await requireAuth(request);
    if (error || !user) {
      return NextResponse.json({error: 'Войдите в систему'}, {status: 401});
    }
    if (user.role !== 'OPERATOR') {
      return NextResponse.json({error: 'Экран доступен только машинисту'}, {status: 403});
    }
    if (!user.tenantId) {
      return NextResponse.json({error: 'Организация пользователя не определена'}, {status: 403});
    }

    const parameters = request.nextUrl.searchParams;
    /*
      ОТСУТСТВИЕ КООРДИНАТ И КООРДИНАТЫ 0°,0° — РАЗНЫЕ ВЕЩИ.

      Было `Number(parameters.get('lat'))`. Для отсутствующего параметра это
      `Number(null)`, то есть НОЛЬ, а ноль проходит и `isFinite`, и проверку
      диапазона. Телефон без геопозиции молча получал погоду для точки 0°,0° —
      это Гвинейский залив, полторы тысячи километров от берега. Проверено:
      запрос без координат и запрос с lat=0&lon=0 давали одинаковые 24,3 °C и
      6,2 м/с, а по настоящим координатам объекта выходило 16,2 °C и 3 м/с.

      Цена ошибки не в погрешности прогноза: по ветру решают, поднимать ли
      мачту, и по нему же экран подставляет ответ в чек-лист ТБ вместо
      человека. Поэтому сначала спрашиваем, ПРИСЛАЛИ ли параметр, и только
      потом разбираем число. Нет координат — нет погоды, и это честно.
    */
    const rawLatitude = parameters.get('lat');
    const rawLongitude = parameters.get('lon');
    const latitude = Number(rawLatitude);
    const longitude = Number(rawLongitude);
    const hasCoordinates = rawLatitude !== null && rawLatitude.trim() !== ''
      && rawLongitude !== null && rawLongitude.trim() !== ''
      && Number.isFinite(latitude) && Number.isFinite(longitude)
      && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;

    const state = await queryOperatorMobileState({
      tenantId: user.tenantId,
      operatorId: user.id,
      operatorName: user.name,
      equipmentId: parameters.get('equipmentId') ?? undefined,
      // Реализация порта погоды подставляется здесь: маршруту разрешено знать
      // о `services/`, модулю правил смены — нет.
      readWeather: getWeatherAt,
      ...(hasCoordinates ? {latitude, longitude} : {}),
    });

    return NextResponse.json({data: state});
  },
  {domain: 'operator.mobile'},
);
