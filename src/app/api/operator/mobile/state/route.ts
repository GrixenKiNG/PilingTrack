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
    const latitude = Number(parameters.get('lat'));
    const longitude = Number(parameters.get('lon'));
    const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude)
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
