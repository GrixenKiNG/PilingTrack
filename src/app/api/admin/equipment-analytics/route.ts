import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { withApi } from '@/core/api-wrapper';
import { getEquipmentAnalytics } from '@/services/analytics/equipment-analytics-service';

export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'analytics.read');

    const sp = request.nextUrl.searchParams;
    const dateFrom = sp.get('dateFrom');
    const dateTo = sp.get('dateTo');
    const siteId = sp.get('siteId');

    // Формат проверяем здесь: кривая дата доходила до Postgres и возвращалась 500.
    const isoDay = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateFrom || !dateTo || !isoDay.test(dateFrom) || !isoDay.test(dateTo)) {
      return NextResponse.json({ error: 'dateFrom и dateTo обязательны (YYYY-MM-DD)' }, { status: 400 });
    }
    if (!user?.tenantId) {
      return NextResponse.json({ error: 'Организация не определена' }, { status: 400 });
    }

    const data = await getEquipmentAnalytics({
      dateFrom,
      dateTo,
      siteId,
      tenantId: user?.tenantId ?? null,
    });
    return NextResponse.json(data);
  },
  { domain: 'admin-analytics' },
);
