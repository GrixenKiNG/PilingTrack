/**
 * Pure report-aggregation logic — per-report and summed piles/meters/drilling/
 * downtime totals, plus shift duration. Extracted from admin-reports.tsx so the
 * "single source of truth" for report metrics is unit-testable and not buried in
 * the screen. Presentation (formatting, labels) stays in the component.
 */
import type { ReportDTO } from '@/lib/types';

export interface ReportTotals {
  piles: number;
  pileMeters: number;
  drillingCount: number;
  drillingMeters: number;
  downtimeHours: number;
  photoCount: number;
}

/** Pile length in metres parsed from a grade name (first 3-digit run = decimetres). */
export function getPileLengthMeters(pileGradeName: string): number {
  const match = pileGradeName.match(/\d{3}/);
  return match ? Number(match[0]) / 10 : 0;
}

/** Totals for one report (photoCount is filled in elsewhere, starts at 0). */
export function getReportTotals(report: ReportDTO): ReportTotals {
  const piles = report.piles?.reduce((sum, pile) => sum + pile.count, 0) || 0;
  const pileMeters = report.piles?.reduce(
    (sum, pile) => sum + getPileLengthMeters(pile.pileGrade?.name || '') * pile.count,
    0,
  ) || 0;
  const drillingCount = report.drillings?.reduce((sum, drilling) => sum + (drilling.count || 1), 0) || 0;
  const drillingMeters = report.drillings?.reduce((sum, drilling) => sum + drilling.meters, 0) || 0;
  const downtimeHours = report.downtimes?.reduce((sum, downtime) => sum + downtime.duration, 0) || 0;

  return { piles, pileMeters, drillingCount, drillingMeters, downtimeHours, photoCount: 0 };
}

/** Sum of getReportTotals across many reports. */
export function addTotals(reports: ReportDTO[]): ReportTotals {
  return reports.reduce<ReportTotals>((acc, report) => {
    const totals = getReportTotals(report);
    acc.piles += totals.piles;
    acc.pileMeters += totals.pileMeters;
    acc.drillingCount += totals.drillingCount;
    acc.drillingMeters += totals.drillingMeters;
    acc.downtimeHours += totals.downtimeHours;
    acc.photoCount += totals.photoCount;
    return acc;
  }, { piles: 0, pileMeters: 0, drillingCount: 0, drillingMeters: 0, downtimeHours: 0, photoCount: 0 });
}

/** Shift length in hours from "HH:MM" start/end; handles overnight; null if unset/invalid. */
export function shiftDurationHours(report: ReportDTO): number | null {
  if (!report.shiftStart || !report.shiftEnd) return null;
  const [startHour, startMinute] = report.shiftStart.split(':').map(Number);
  const [endHour, endMinute] = report.shiftEnd.split(':').map(Number);
  if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return null;
  const start = startHour * 60 + startMinute;
  let end = endHour * 60 + endMinute;
  if (end < start) end += 24 * 60;
  return (end - start) / 60;
}
