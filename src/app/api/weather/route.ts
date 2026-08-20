import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withApi } from '@/core/api-wrapper';
import { getSiteWind, WIND_BOOM_TRANSPORT_MS, WIND_STOP_WORK_MS } from '@/services/weather/weather-client';

export const runtime = 'nodejs';

/**
 * Ветер на объекте плюс пороги из руководства.
 *
 * Пороги отдаём вместе с показанием, чтобы экран не хранил их копию: разойтись
 * они не должны, а живут они в клиенте погоды рядом с чтением.
 */
export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    const siteId = request.nextUrl.searchParams.get('siteId');
    if (!siteId) return NextResponse.json({ error: 'Не указан объект' }, { status: 400 });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    if (!tenantId) return NextResponse.json({ error: 'Организация не определена' }, { status: 400 });

    const wind = await getSiteWind(tenantId, siteId);
    return NextResponse.json({
      wind,
      thresholds: { stopWorkMs: WIND_STOP_WORK_MS, boomTransportMs: WIND_BOOM_TRANSPORT_MS },
    });
  },
  { domain: 'weather' }
);
