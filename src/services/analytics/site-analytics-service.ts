import { db } from '@/lib/db';

export async function getSiteAnalytics() {
  const sites = await db.site.findMany({
    where: { isActive: true },
    include: {
      _count: { select: { reports: true } },
      reports: {
        select: {
          piles: { select: { count: true } },
          drillings: { select: { meters: true } },
          downtimes: { select: { duration: true } },
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  return sites.map((site) => {
    const actualPiles = site.reports.reduce(
      (sum, report) => sum + report.piles.reduce((acc, pile) => acc + pile.count, 0),
      0
    );
    const actualDrilling = site.reports.reduce(
      (sum, report) => sum + report.drillings.reduce((acc, drilling) => acc + drilling.meters, 0),
      0
    );
    const totalDowntime = site.reports.reduce(
      (sum, report) => sum + report.downtimes.reduce((acc, downtime) => acc + downtime.duration, 0),
      0
    );

    return {
      siteId: site.id,
      siteName: site.name,
      plannedPiles: site.plannedPiles,
      actualPiles,
      plannedDrilling: site.plannedDrilling,
      actualDrilling: parseFloat(actualDrilling.toFixed(1)),
      pileProgress: site.plannedPiles > 0 ? Math.min(100, (actualPiles / site.plannedPiles) * 100) : 0,
      drillingProgress:
        site.plannedDrilling > 0 ? Math.min(100, (actualDrilling / site.plannedDrilling) * 100) : 0,
      totalReports: site._count.reports,
      totalDowntime: parseFloat(totalDowntime.toFixed(1)),
    };
  });
}
