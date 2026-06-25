import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { getFleetKpiData } from '@/modules/equipment';
import { computeFleetKpi } from '@/lib/fleet-kpi';
import { withApi } from '@/core/api-wrapper';

export const runtime = 'nodejs';

const DAY_MS = 86_400_000;

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'maintenance.manage');

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';

    const sp = request.nextUrl.searchParams;
    const toParam = sp.get('to');
    const fromParam = sp.get('from');
    const to = toParam ? new Date(toParam) : new Date();
    const from = fromParam ? new Date(fromParam) : new Date(to.getTime() - 30 * DAY_MS);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
      return NextResponse.json({ error: 'Invalid date range' }, { status: 400 });
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
