/**
 * Filter pile grades to those planned for the selected site.
 *
 * The operator dropdown should only show grades that the backend will
 * accept — i.e. grades present in the site's pile plan. If a site has no
 * plan at all, fall back to the full catalogue (legacy sites).
 */
export interface PileGradeRef { id: string }
export interface PilePlanRef { pileGradeId: string }

export function filterPileGradesBySitePlan<G extends PileGradeRef>(
  pileGrades: G[],
  pilePlans: PilePlanRef[] | undefined | null,
): G[] {
  if (!pilePlans || pilePlans.length === 0) return pileGrades;
  const allowed = new Set(pilePlans.map((p) => p.pileGradeId));
  return pileGrades.filter((g) => allowed.has(g.id));
}
