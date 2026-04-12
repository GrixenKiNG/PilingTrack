/**
 * Report Validation Service — Application Layer
 *
 * Validates report inputs before they reach the domain aggregate.
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';

export function validateDowntimeWithinShift(
  shiftStart?: string | null,
  shiftEnd?: string | null,
  downtimes?: Array<{ duration: number }>
) {
  if (!shiftStart || !shiftEnd) return;

  const [startHours, startMinutes] = shiftStart.split(':').map(Number);
  const [endHours, endMinutes] = shiftEnd.split(':').map(Number);

  let shiftHours = (endHours * 60 + endMinutes - startHours * 60 - startMinutes) / 60;

  if (shiftHours < 0) shiftHours += 24;

  const totalDowntime = (downtimes || []).reduce((sum, d) => sum + d.duration, 0);

  if (totalDowntime > shiftHours) {
    throw new ServiceError(
      `Суммарный простой (${totalDowntime}ч) превышает продолжительность смены (${shiftHours}ч)`,
      400
    );
  }
}

export function validateReportDateNotInFuture(date: string) {
  const today = new Date().toISOString().split('T')[0];
  if (date > today) {
    throw new ServiceError('Дата отчёта не может быть в будущем', 400);
  }
}

export function validateReportRequiredFields(input: {
  reportId?: string;
  siteId?: string;
  userId?: string;
  date?: string;
}) {
  if (!input.reportId || !input.siteId || !input.userId || !input.date) {
    throw new ServiceError('Missing required fields', 400);
  }
}

export function validatePileEntries(
  piles?: Array<{ pileGradeId: string; count: number }>
) {
  if (!piles || piles.length === 0) return;

  for (const pile of piles) {
    if (pile.count < 1) {
      throw new ServiceError(`Количество свай должно быть ≥ 1 (марка: ${pile.pileGradeId})`, 400);
    }
    if (pile.count > 9999) {
      throw new ServiceError(`Количество свай не может превышать 9999 (марка: ${pile.pileGradeId})`, 400);
    }
  }
}

export function validateDrillingEntries(
  drillings?: Array<{ typeId: string; meters: number; count?: number }>
) {
  if (!drillings || drillings.length === 0) return;

  for (const d of drillings) {
    if (d.meters < 0) {
      throw new ServiceError(`Метраж бурения не может быть отрицательным (тип: ${d.typeId})`, 400);
    }
    if (d.meters > 99999) {
      throw new ServiceError(`Метраж бурения не может превышать 99999м (тип: ${d.typeId})`, 400);
    }
    if ((d.count ?? 1) < 1) {
      throw new ServiceError(`Количество бурений должно быть ≥ 1 (тип: ${d.typeId})`, 400);
    }
  }
}

export function validateDowntimeEntries(
  downtimes?: Array<{ reasonId: string; duration: number }>
) {
  if (!downtimes || downtimes.length === 0) return;

  for (const dt of downtimes) {
    if (dt.duration < 0) {
      throw new ServiceError(`Длительность простоя не может быть отрицательной`, 400);
    }
    if (dt.duration > 1440) {
      throw new ServiceError(`Длительность простоя не может превышать 1440 минут (24ч)`, 400);
    }
  }
}

export function validateReportInput(input: {
  reportId?: string;
  siteId?: string;
  userId?: string;
  date?: string;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  piles?: Array<{ pileGradeId: string; count: number }>;
  drillings?: Array<{ typeId: string; meters: number; count?: number }>;
  downtimes?: Array<{ reasonId: string; duration: number }>;
}) {
  validateReportRequiredFields(input);
  validateReportDateNotInFuture(input.date!);
  validatePileEntries(input.piles);
  validateDrillingEntries(input.drillings);
  validateDowntimeEntries(input.downtimes);
  validateDowntimeWithinShift(input.shiftStart, input.shiftEnd, input.downtimes);
}

export async function validateAgainstSitePlans(
  siteId: string,
  currentReportId: string | undefined,
  piles: Array<{ pileGradeId: string; count: number }>,
  drillings: Array<{ typeId: string; count: number; meters: number }>
): Promise<void> {
  if (!piles || piles.length === 0) return;

  // Load site pile plans
  const plans = await db.sitePilePlan.findMany({
    where: { siteId },
    include: { pileGrade: true },
  });

  if (plans.length === 0) return; // No plans defined, skip validation

  // Load all existing reports for this site (excluding current report if updating)
  const existingReports = await db.report.findMany({
    where: {
      siteId,
      ...(currentReportId ? { NOT: { reportId: currentReportId } } : {}),
    },
    include: { piles: true },
  });

  // Sum actuals by pileGradeId
  const actualByGrade = new Map<string, number>();
  for (const report of existingReports) {
    for (const pile of report.piles) {
      actualByGrade.set(
        pile.pileGradeId,
        (actualByGrade.get(pile.pileGradeId) || 0) + pile.count
      );
    }
  }

  // Check against plans
  for (const plan of plans) {
    const actual = actualByGrade.get(plan.pileGradeId) || 0;
    const newPiles = piles.find(p => p.pileGradeId === plan.pileGradeId)?.count || 0;
    const total = actual + newPiles;

    if (total > plan.count) {
      throw new ServiceError(
        `Превышение плана по марке "${plan.pileGrade.name}": план ${plan.count} шт., уже забито ${actual} шт., будет ${total} шт.`,
        400
      );
    }
  }
}
