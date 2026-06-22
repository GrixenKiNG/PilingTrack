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

    if (!dateFrom || !dateTo) {
      return NextResponse.json({ error: 'dateFrom and dateTo are required' }, { status: 400 });
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
