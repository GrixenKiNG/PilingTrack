import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { withApi } from '@/core/api-wrapper';
import { pileLengthMeters } from '@/lib/pile-length';


export const runtime = 'nodejs';

export interface PeriodReportInput {
  siteId: string;
  userId: string;
  piles?: Array<{ count: number; pileGradeId: string; pileGrade?: { name: string; lengthMm?: number | null } | null }>;
  drillings?: Array<{ count?: number | null; meters?: number | null }>;
  downtimes?: Array<{ duration?: number | null }>;
}

export function computePeriodSummary(reports: PeriodReportInput[]) {
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
      totalPileMeters += (p.count || 0) * pileLengthMeters({ gradeLengthMm: p.pileGrade?.lengthMm });
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
