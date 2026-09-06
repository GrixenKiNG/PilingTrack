/**
 * Итоги отчётов за период — чистая агрегация.
 *
 * Жила прямо в файле маршрута `/api/reports/period` и экспортировалась
 * оттуда ради теста. Next.js запрещает маршруту экспортировать что-либо,
 * кроме обработчиков, и production-сборка на этом падала — при том что
 * dev-сервер работал. Чистому расчёту место в домене отчётов: он не знает
 * ни запроса, ни ответа.
 */
import { pileLengthMeters } from '@/lib/pile-length';

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
