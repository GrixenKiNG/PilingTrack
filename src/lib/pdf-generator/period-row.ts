import type { PeriodReportRow } from './types';

export function toPeriodReportRow(value: unknown): PeriodReportRow {
  return (value && typeof value === 'object' ? value : {}) as PeriodReportRow;
}

export function sumPiles(report: PeriodReportRow): number {
  return (report.piles || []).reduce((sum, pile) => sum + (pile.count || 0), 0);
}

export function sumDrilling(report: PeriodReportRow): number {
  return (report.drillings || []).reduce((sum, drilling) => sum + (drilling.meters || 0), 0);
}

export function sumDowntime(report: PeriodReportRow): number {
  return (report.downtimes || []).reduce((sum, downtime) => sum + (downtime.duration || 0), 0);
}
