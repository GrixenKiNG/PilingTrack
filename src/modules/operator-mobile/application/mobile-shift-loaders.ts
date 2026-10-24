import {db} from '@/lib/db';
import {pileLengthMeters} from '@/lib/pile-length';
import type { WorkVolume } from '../domain/view-contracts';

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Забито на объекте за всё время: штуки и метры погонные.
 *
 * Считаем группировкой по марке, а не выборкой всех строк: на объекте, где
 * забито десять тысяч свай, второе означало бы десять тысяч строк в память
 * ради одной суммы. Метры разворачиваются из длины марки — единственного
 * источника длины в продукте.
 */
export async function sitePileVolume(
  tenantId: string,
  siteId: string,
  grades: {id: string; lengthMm: number | null}[],
): Promise<WorkVolume & {countByGrade: Map<string, number>}> {
  const groups = await db.pileWork.groupBy({
    by: ['pileGradeId'],
    _sum: {count: true},
    where: {report: {tenantId, siteId}},
  });
  const length = new Map(grades.map((grade) => [grade.id, grade.lengthMm]));

  let count = 0;
  let meters = 0;
  const countByGrade = new Map<string, number>();
  for (const group of groups) {
    const piles = group._sum.count ?? 0;
    count += piles;
    meters += piles * pileLengthMeters({gradeLengthMm: length.get(group.pileGradeId) ?? null});
    countByGrade.set(group.pileGradeId, piles);
  }
  return {count, meters: round1(meters), countByGrade};
}

/**
 * Справочники приезжают вместе с состоянием, а не отдельным запросом: экран
 * учёта выработки без них бесполезен, а второй запрос — второй шанс не доехать.
 */
export async function loadDictionaries(tenantId: string) {
  const [pileGrades, drillingTypes, downtimeReasons] = await Promise.all([
    db.pileGrade.findMany({
      where: {tenantId, isActive: true},
      select: {id: true, name: true, lengthMm: true},
      orderBy: {name: 'asc'},
    }),
    db.drillingType.findMany({
      where: {tenantId, isActive: true},
      select: {id: true, name: true},
      orderBy: {name: 'asc'},
    }),
    db.downtimeReason.findMany({
      where: {tenantId, isActive: true},
      select: {id: true, name: true},
      orderBy: {name: 'asc'},
    }),
  ]);
  return {pileGrades, drillingTypes, downtimeReasons};
}
