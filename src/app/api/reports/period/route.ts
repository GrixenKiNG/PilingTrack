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

    // PileWork has no metersPerUnit — it's stored per-site on SitePilePlan.
    // Build a (siteId|pileGradeId) → metersPerUnit map for accurate totalPileMeters.
    const pileKeys = new Set<string>();
    for (const r of reports as any[]) {
      for (const p of r.piles || []) pileKeys.add(`${r.siteId}|${p.pileGradeId}`);
    }
    const pileLengthFromName = (name: string) => {
      const m = name.match(/\d{3}/);
      return m ? Number(m[0]) / 10 : 0;
    };
    const meterMap = new Map<string, number>();
    if (pileKeys.size > 0) {
      const { db } = await import('@/lib/db');
      const plans = await db.sitePilePlan.findMany({
        where: { OR: Array.from(pileKeys).map((k) => { const [s, g] = k.split('|'); return { siteId: s, pileGradeId: g }; }) },
        select: { siteId: true, pileGradeId: true, metersPerUnit: true },
      });
      for (const pl of plans) meterMap.set(`${pl.siteId}|${pl.pileGradeId}`, pl.metersPerUnit || 0);
    }

    const summary = {
      totalPiles: reports.reduce((sum: number, report: any) => sum + (report.piles?.reduce((s: number, pile: any) => s + (pile.count || 0), 0) || 0), 0),
      totalPileMeters: reports.reduce((sum: number, report: any) => sum + (report.piles?.reduce((s: number, pile: any) => {
        const mpu = meterMap.get(`${report.siteId}|${pile.pileGradeId}`) || pileLengthFromName(pile.pileGrade?.name || '');
        return s + (pile.count || 0) * mpu;
      }, 0) || 0), 0),
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
