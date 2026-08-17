import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { withApi } from '@/core/api-wrapper';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'analytics.read');
    // Fail closed: без организации выборка ушла бы по всем тенантам сразу.
    if (!user?.tenantId) return NextResponse.json({ error: 'Организация не определена' }, { status: 400 });

    const siteId = request.nextUrl.searchParams.get('siteId');
    const weeksParam = Number(request.nextUrl.searchParams.get('weeks') ?? '8');
    const weeks = Math.min(Math.max(weeksParam, 1), 52);

    const where: Record<string, unknown> = { tenantId: user.tenantId };
    if (siteId && siteId !== 'all') where.siteId = siteId;

    const rows = await db.siteWeeklyTrend.findMany({
      where,
      orderBy: { weekStart: 'desc' },
      take: weeks * (siteId === 'all' || !siteId ? 10 : 1),
    });

    return NextResponse.json({ rows });
  },
  { domain: 'admin-analytics' }
);
