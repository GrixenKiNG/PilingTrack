/**
 * Report Calculation Service — Application Layer
 *
 * Business calculations: plan validation, metrics, summaries.
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';

export async function validateAgainstSitePlans(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma interactive-transaction callback client type isn't cleanly exported
  tx: ReturnType<typeof db.$transaction> extends (cb: (tx: infer T) => any) => any ? T : any,
  siteId: string,
  piles: Array<{ pileGradeId: string; count: number }>,
  drillings: Array<{ typeId: string; meters: number }>
) {
  if (piles.length > 0) {
    const pilePlans = await tx.sitePilePlan.findMany({
      where: { siteId },
      select: { pileGradeId: true, count: true },
    });

    if (pilePlans.length > 0) {
      const existingPiles = await tx.pileWork.groupBy({
        by: ['pileGradeId'],
        where: { report: { siteId } },
        _sum: { count: true },
      });

      const existingByGrade = new Map<string, number>();
      for (const ep of existingPiles) {
        existingByGrade.set(ep.pileGradeId, ep._sum.count || 0);
      }

      for (const plan of pilePlans) {
        const existing = existingByGrade.get(plan.pileGradeId) || 0;
        const newPile = piles.find(p => p.pileGradeId === plan.pileGradeId);
        const newCount = newPile?.count || 0;
        const total = existing + newCount;

        if (total > plan.count) {
          throw new ServiceError(
            `Превышение плана по марке свай: план ${plan.count}, факт будет ${total} (+${newCount})`,
            400
          );
        }
      }
    }
  }

  if (drillings.length > 0) {
    const drillingPlans = await tx.siteDrillingPlan.findMany({
      where: { siteId },
      select: { diameter: true, count: true, metersPerUnit: true },
    });

    if (drillingPlans.length > 0) {
      const existingDrilling = await tx.leaderDrilling.aggregate({
        where: { report: { siteId } },
        _sum: { meters: true },
      });

      const existingMeters = existingDrilling._sum.meters || 0;
      const newMeters = drillings.reduce((sum, d) => sum + d.meters, 0);
      const totalMeters = existingMeters + newMeters;

      const plannedMeters = drillingPlans.reduce(
        (sum: number, plan: { count: number; metersPerUnit: number }) => sum + plan.count * plan.metersPerUnit,
        0
      );

      if (plannedMeters > 0 && totalMeters > plannedMeters) {
        throw new ServiceError(
          `Превышение плана по бурению: план ${plannedMeters}м, факт будет ${totalMeters.toFixed(1)}м (+${newMeters}м)`,
          400
        );
      }
    }
  }
}

export function calculateReportSummary(report: {
  piles: Array<{ count: number }>;
  drillings: Array<{ meters: number }>;
  downtimes: Array<{ duration: number }>;
}) {
  const totalPiles = report.piles.reduce((sum, p) => sum + p.count, 0);
  const totalDrilling = report.drillings.reduce((sum, d) => sum + d.meters, 0);
  const totalDowntime = report.downtimes.reduce((sum, d) => sum + d.duration, 0);

  return {
    totalPiles,
    totalDrilling: Math.round(totalDrilling * 100) / 100,
    totalDowntime: Math.round(totalDowntime * 100) / 100,
    pileCount: report.piles.length,
    drillingCount: report.drillings.length,
    downtimeCount: report.downtimes.length,
  };
}

export function calculatePeriodSummary(reports: Array<{
  piles: Array<{ count: number }>;
  drillings: Array<{ meters: number }>;
  downtimes: Array<{ duration: number }>;
}>) {
  let totalPiles = 0;
  let totalDrilling = 0;
  let totalDowntime = 0;

  for (const report of reports) {
    totalPiles += report.piles.reduce((sum, p) => sum + p.count, 0);
    totalDrilling += report.drillings.reduce((sum, d) => sum + d.meters, 0);
    totalDowntime += report.downtimes.reduce((sum, d) => sum + d.duration, 0);
  }

  return {
    totalPiles,
    totalDrilling: Math.round(totalDrilling * 100) / 100,
    totalDowntime: Math.round(totalDowntime * 100) / 100,
    reportCount: reports.length,
  };
}

export function getPileMetersPerUnit(
  pileGradeId: string,
  grades: Array<{ id: string; name: string }>
): number {
  const grade = grades.find(g => g.id === pileGradeId);
  return grade ? 1 : 0;
}

export function calculateDrillingVolume(count: number, metersPerUnit: number): number {
  return count * metersPerUnit;
}
