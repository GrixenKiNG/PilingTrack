import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { exportReportsCsv } from '@/modules/reports';
import { withApi } from '@/core/api-wrapper';


export const runtime = 'nodejs';

const MAX_EXPORT_WINDOW_DAYS = 92; // ~1 quarter

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'reports.export');

    const dateFrom = request.nextUrl.searchParams.get('dateFrom');
    const dateTo = request.nextUrl.searchParams.get('dateTo');
    const siteId = request.nextUrl.searchParams.get('siteId');

    if (!dateFrom || !dateTo) {
      return NextResponse.json(
        { error: 'dateFrom and dateTo are required (max 92 days)' },
        { status: 400 },
      );
    }

    const fromTs = Date.parse(dateFrom);
    const toTs = Date.parse(dateTo);
    if (Number.isNaN(fromTs) || Number.isNaN(toTs) || toTs < fromTs) {
      return NextResponse.json(
        { error: 'Invalid dateFrom/dateTo' },
        { status: 400 },
      );
    }

    const windowDays = (toTs - fromTs) / (1000 * 60 * 60 * 24);
    if (windowDays > MAX_EXPORT_WINDOW_DAYS) {
      return NextResponse.json(
        { error: `Date range must be at most ${MAX_EXPORT_WINDOW_DAYS} days` },
        { status: 400 },
      );
    }

    const csv = await exportReportsCsv({
      siteId,
      dateFrom,
      dateTo,
    });

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="pilingtrack-reports-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
  },
  { domain: 'reports' }
);
