import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { withApi } from '@/core/api-wrapper';


export const runtime = 'nodejs';

async function getReportQueryService() {
  return import('@/modules/reports/application/queries/report-query.service');
}

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'reports.read_all');
    const dateFrom = request.nextUrl.searchParams.get('dateFrom');
    const dateTo = request.nextUrl.searchParams.get('dateTo');
    const siteId = request.nextUrl.searchParams.get('siteId');

    const { getReportsByPeriod } = await getReportQueryService();
    const reports = await getReportsByPeriod(dateFrom, dateTo, siteId, user?.tenantId || null);
    const pileLengthFromName = (name: string) => {
      const m = name.match(/\d{3}/);
      return m ? Number(m[0]) / 10 : 0;
    };
    const summary = {
      totalPiles: reports.reduce((sum: number, report: any) => sum + (report.piles?.reduce((s: number, pile: any) => s + (pile.count || 0), 0) || 0), 0),
      totalPileMeters: reports.reduce((sum: number, report: any) => sum + (report.piles?.reduce((s: number, pile: any) => s + (pile.count || 0) * (pile.metersPerUnit || pileLengthFromName(pile.pileGrade?.name || '')), 0) || 0), 0),
      totalDrillingCount: reports.reduce((sum: number, report: any) => sum + (report.drillings?.reduce((s: number, drilling: any) => s + (drilling.count || 1), 0) || 0), 0),
      totalDrilling: reports.reduce((sum: number, report: any) => sum + (report.drillings?.reduce((s: number, drilling: any) => s + (drilling.meters || 0), 0) || 0), 0),
      totalDowntime: reports.reduce((sum: number, report: any) => sum + (report.downtimes?.reduce((s: number, downtime: any) => s + (downtime.duration || 0), 0) || 0), 0),
      reportCount: reports.length,
      uniqueSites: new Set(reports.map((report: any) => report.siteId)).size,
      uniqueOperators: new Set(reports.map((report: any) => report.userId)).size,
    };

    return NextResponse.json({ reports, summary });
  },
  { domain: 'reports' }
);
