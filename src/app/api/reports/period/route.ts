import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { withApi } from '@/core/api-wrapper';


export const runtime = 'nodejs';

export interface PeriodReportInput {
  siteId: string;
  userId: string;
  piles?: Array<{ count: number; pileGradeId: string; pileGrade?: { name: string } | null }>;
  drillings?: Array<{ count?: number | null; meters?: number | null }>;
  downtimes?: Array<{ duration?: number | null }>;
}

export interface PilePlanInput {
  siteId: string;
  pileGradeId: string;
  metersPerUnit: number;
}

const pileLengthFromName = (name: string) => {
  const m = name.match(/\d{3}/);
  return m ? Number(m[0]) / 10 : 0;
};

export function computePeriodSummary(
  reports: PeriodReportInput[],
  plans: PilePlanInput[],
) {
  const meterMap = new Map<string, number>();
  for (const pl of plans) meterMap.set(`${pl.siteId}|${pl.pileGradeId}`, pl.metersPerUnit || 0);

  let totalPiles = 0;
  let totalPileMeters = 0;
  let totalDrillingCount = 0;
  let totalDrilling = 0;
  let totalDowntime = 0;
  const sites = new Set<string>();
  const operators = new Set<string>();

  for (const r of reports) {
    sites.add(r.siteId);
    operators.add(r.userId);
    for (const p of r.piles || []) {
      totalPiles += p.count || 0;
      const mpu = meterMap.get(`${r.siteId}|${p.pileGradeId}`)
        || pileLengthFromName(p.pileGrade?.name || '');
      totalPileMeters += (p.count || 0) * mpu;
    }
    for (const d of r.drillings || []) {
      totalDrillingCount += d.count ?? 1;
      totalDrilling += d.meters || 0;
    }
    for (const dt of r.downtimes || []) {
      totalDowntime += dt.duration || 0;
    }
  }

  return {
    totalPiles, totalPileMeters, totalDrillingCount, totalDrilling, totalDowntime,
    reportCount: reports.length,
    uniqueSites: sites.size,
    uniqueOperators: operators.size,
  };
}

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
    const userId = request.nextUrl.searchParams.get('userId');

    const { getReportsByPeriod } = await getReportQueryService();
    const reports = await getReportsByPeriod(dateFrom, dateTo, siteId, user?.tenantId || null, userId);

    // PileWork has no metersPerUnit — it's stored per-site on SitePilePlan.
    const pileKeys = new Set<string>();
    for (const r of reports as any[]) {
      for (const p of r.piles || []) pileKeys.add(`${r.siteId}|${p.pileGradeId}`);
    }
    let plans: Array<{ siteId: string; pileGradeId: string; metersPerUnit: number }> = [];
    if (pileKeys.size > 0) {
      const { db } = await import('@/lib/db');
      plans = await db.sitePilePlan.findMany({
        where: { OR: Array.from(pileKeys).map((k) => { const [s, g] = k.split('|'); return { siteId: s, pileGradeId: g }; }) },
        select: { siteId: true, pileGradeId: true, metersPerUnit: true },
      });
    }

    const summary = computePeriodSummary(reports as PeriodReportInput[], plans);
    return NextResponse.json({ reports, summary });
  },
  { domain: 'reports' }
);
