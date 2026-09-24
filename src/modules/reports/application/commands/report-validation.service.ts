/**
 * Report Validation Service — Application Layer
 *
 * Validates report inputs before they reach the domain aggregate.
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
import { getTodayInTimezone } from '@/lib/timezone';

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
  // Business-timezone "today", not server UTC: with the server on UTC an
  // operator's legitimate MSK "today" was rejected between 00:00 and 03:00 MSK.
  const today = getTodayInTimezone();
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
    if (dt.duration > 24) {
      throw new ServiceError(`Длительность простоя не может превышать 24 часа`, 400);
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
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null invariant established earlier in this function
  validateReportDateNotInFuture(input.date!);
  validatePileEntries(input.piles);
  validateDrillingEntries(input.drillings);
  validateDowntimeEntries(input.downtimes);
  validateDowntimeWithinShift(input.shiftStart, input.shiftEnd, input.downtimes);
}

/**
 * Every picketId referenced by a pile/drilling row must belong to the report's
 * site (Picket → Cluster → PileField → Site). Without this, a stale picket from
 * a previously-selected site could be saved against the new site and pollute
 * per-picket production stats.
 */
export async function validatePicketsBelongToSite(
  siteId: string,
  rows: Array<{ picketId?: string | null }>
): Promise<void> {
  const picketIds = [...new Set(rows.map((r) => r.picketId).filter((id): id is string => !!id))];
  if (picketIds.length === 0) return;

  const pickets = await db.picket.findMany({
    where: { id: { in: picketIds } },
    select: { id: true, cluster: { select: { field: { select: { siteId: true } } } } },
  });

  const bySite = new Map(pickets.map((p) => [p.id, p.cluster.field.siteId]));
  for (const picketId of picketIds) {
    const owner = bySite.get(picketId);
    if (owner !== siteId) {
      throw new ServiceError('Пикет не принадлежит выбранному объекту', 400);
    }
  }
}

type PlanCheckClient = Pick<typeof db, 'sitePilePlan' | 'pileGrade' | 'pileWork' | '$executeRaw'>;

/**
 * План объекта по маркам свай.
 *
 * ВЫЗЫВАЕТСЯ ВНУТРИ ТРАНЗАКЦИИ СОХРАНЕНИЯ, ПОСЛЕ ЗАПИСИ СВАЙ ОТЧЁТА. Итог по
 * марке берётся из базы вместе со строками этого же отчёта, поэтому не нужно
 * ни складывать присланное с «уже забитым», ни угадывать, какой отчёт
 * исключить. Прежняя проверка шла до транзакции и ошибалась трижды: брала
 * только первую строку марки (сваи по разным пикетам проходили мимо плана),
 * считала отчёт дважды, когда сервер находил его по дате под другим номером,
 * и пропускала два одновременных отчёта, каждый из которых укладывался в план
 * сам по себе. От последнего защищает блокировка на объект до конца транзакции.
 *
 * Правка, не добавляющая свай марки (`previousCountByGrade`), не отвергается:
 * иначе объект, где план уже превышен (машинист получает об этом только
 * предупреждение), стал бы нередактируемым целиком.
 */
export async function validateAgainstSitePlans(
  client: PlanCheckClient,
  siteId: string,
  piles: Array<{ pileGradeId: string; count: number }>,
  previousCountByGrade: Map<string, number> = new Map(),
): Promise<void> {
  if (!piles || piles.length === 0) return;

  // Load site pile plans
  const plans = await client.sitePilePlan.findMany({
    where: { siteId },
    include: { pileGrade: true },
  });

  if (plans.length === 0) return; // No plans defined, skip validation

  // Rule 1: every submitted pileGrade must exist in the site's plan.
  // Operators must not be able to log piles of a grade that wasn't planned
  // for this site — that bypasses the per-grade plan cap entirely.
  const plannedGradeIds = new Set(plans.map(p => p.pileGradeId));
  for (const pile of piles) {
    if (!plannedGradeIds.has(pile.pileGradeId)) {
      // Look up grade name for a useful error message.
      const grade = await client.pileGrade.findUnique({
        where: { id: pile.pileGradeId },
        select: { name: true },
      });
      const gradeLabel = grade?.name || pile.pileGradeId;
      throw new ServiceError(
        `Марка "${gradeLabel}" не запланирована на этом объекте. Доступные марки: ${plans.map(p => p.pileGrade.name).join(', ')}`,
        400
      );
    }
  }

  // Rule 2: the grade total on the site, this report included, must not exceed plan.
  const submittedByGrade = new Map<string, number>();
  for (const pile of piles) {
    submittedByGrade.set(pile.pileGradeId, (submittedByGrade.get(pile.pileGradeId) ?? 0) + pile.count);
  }

  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`site-pile-plan:${siteId}`}))`;
  const totals = await client.pileWork.groupBy({
    by: ['pileGradeId'],
    where: { report: { siteId }, pileGradeId: { in: [...submittedByGrade.keys()] } },
    _sum: { count: true },
  });
  const totalByGrade = new Map(totals.map((row) => [row.pileGradeId, row._sum.count ?? 0]));

  for (const plan of plans) {
    const submitted = submittedByGrade.get(plan.pileGradeId);
    if (submitted === undefined) continue;
    if (submitted <= (previousCountByGrade.get(plan.pileGradeId) ?? 0)) continue;

    const total = totalByGrade.get(plan.pileGradeId) ?? 0;
    if (total > plan.count) {
      throw new ServiceError(
        `Превышение плана по марке "${plan.pileGrade.name}": план ${plan.count} шт., уже забито ${total - submitted} шт., будет ${total} шт.`,
        400
      );
    }
  }
}
