import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { getFleetKpiData } from '@/modules/equipment';
import { computeFleetKpi } from '@/lib/fleet-kpi';
import { getSettings } from '@/modules/settings';
import { withApi } from '@/core/api-wrapper';
import { zonedDayStartUtc } from '@/lib/timezone';

export const runtime = 'nodejs';

const DAY_MS = 86_400_000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Следующий календарный день ГГГГ-ММ-ДД. */
function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * Границы окна KPI из параметра запроса.
 *
 * Экран присылает производственный день строкой (ГГГГ-ММ-ДД), а сервер живёт в
 * UTC: наивная строка `…T00:00:00` разбиралась `new Date()` в поясе процесса и
 * сдвигала окно на 3 часа — работа 20.09 00:00–03:00 МСК в период не входила, а
 * 27.09 00:00–03:00 МСК входила (F-R37-3). День переводим в момент по поясу
 * организации: `from` — полночь первого дня, `to` — полночь дня после
 * последнего (исключающая граница). Полная ISO-метка принимается как есть —
 * для обратной совместимости.
 */
function windowBound(value: string, kind: 'from' | 'to', timezone: string): Date {
  if (!YMD.test(value)) return new Date(value);
  return kind === 'from'
    ? zonedDayStartUtc(value, timezone)
    : zonedDayStartUtc(addDays(value, 1), timezone);
}

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'maintenance.manage');

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = requireTenantId(user!);

    const sp = request.nextUrl.searchParams;
    const toParam = sp.get('to');
    const fromParam = sp.get('from');
    const timezone = (await getSettings(tenantId)).timezone;
    const to = toParam ? windowBound(toParam, 'to', timezone) : new Date();
    const from = fromParam ? windowBound(fromParam, 'from', timezone) : new Date(to.getTime() - 30 * DAY_MS);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
      return NextResponse.json({ error: 'Некорректный диапазон дат' }, { status: 400 });
    }

    const { records, equipmentCount } = await getFleetKpiData(tenantId, from, to);
    const kpi = computeFleetKpi(records, { from, to, equipmentCount });
    return NextResponse.json({
      kpi,
      period: { from: from.toISOString(), to: to.toISOString() },
      equipmentCount,
    });
  },
  { domain: 'equipment.maintenance' }
);
