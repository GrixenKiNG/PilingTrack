import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { withApi } from '@/core/api-wrapper';
import { computePeriodSummary, type PeriodReportInput } from '@/modules/reports/domain/period-summary';


export const runtime = 'nodejs';

async function getReportQueryService() {
  return import('@/modules/reports/application/queries/report-query.service');
}

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'reports.read_all');
    const dateFrom = request.nextUrl.searchParams.get('dateFrom');
    const dateTo = request.nextUrl.searchParams.get('dateTo');
    const siteId = request.nextUrl.searchParams.get('siteId');
    const userId = request.nextUrl.searchParams.get('userId');

    const { getReportsByPeriod } = await getReportQueryService();
    const reports = await getReportsByPeriod(dateFrom, dateTo, siteId, user?.tenantId || null, userId);

    // Pile metres come from the grade length (PileGrade.lengthMm), carried on each
    // pile row — no SitePilePlan lookup, the plan is not a length source.
    const summary = computePeriodSummary(reports as PeriodReportInput[]);
    return NextResponse.json({ reports, summary });
  },
  { domain: 'reports' }
);
