import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withApi } from '@/core/api-wrapper';


export const runtime = 'nodejs';

async function getReportQueryService() {
  return import('@/modules/reports/application/queries/report-query.service');
}

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    const { searchParams } = request.nextUrl;
    const requestedUserId = searchParams.get('userId');
    const siteId = searchParams.get('siteId');
    const date = searchParams.get('date');

    const { getEditableReport } = await getReportQueryService();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const report = await getEditableReport(user!, requestedUserId, siteId, date);
    return NextResponse.json({ report: report || null });
  },
  { domain: 'reports' }
);
