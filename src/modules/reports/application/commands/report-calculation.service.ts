/**
 * Report Calculation Service — Application Layer
 *
 * Business calculations: metrics, summaries. Plan validation lives in
 * report-validation.service.ts (it runs inside the save transaction).
 */

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
