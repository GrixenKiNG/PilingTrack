import type { PilePlanRow, DrillingPlanRow } from '../types';

export const emptyPilePlanRow = (): PilePlanRow => ({
  tempId: crypto.randomUUID(),
  pileGradeId: '',
  count: 0,
  metersPerUnit: 0,
});

export const emptyDrillingPlanRow = (): DrillingPlanRow => ({
  tempId: crypto.randomUUID(),
  diameter: 0,
  count: 0,
  metersPerUnit: 0,
});

export const totalPileCount = (plans: PilePlanRow[]) =>
  plans.reduce((s, p) => s + (Number(p.count) || 0), 0);

export const totalPileMeters = (plans: PilePlanRow[]) =>
  plans.reduce((s, p) => s + (Number(p.count) || 0) * (Number(p.metersPerUnit) || 0), 0);

export const totalDrillingMeters = (plans: DrillingPlanRow[]) =>
  plans.reduce((s, p) => s + (Number(p.count) || 0) * (Number(p.metersPerUnit) || 0), 0);

// Строки, которые сервер реально примет (та же логика, что в use-site-mutations).
export const validPileRows = (plans: PilePlanRow[]) =>
  plans.filter((p) => p.pileGradeId && p.count > 0);
export const validDrillingRows = (plans: DrillingPlanRow[]) =>
  plans.filter((p) => p.count > 0);

/**
 * Сохранение с пустым планом — деструктивно: сервер стирает ВСЕ строки плана
 * и обнуляет план объекта (инцидент 2026-07-17: план 7000/72000 «Новгорода»
 * молча ушёл в ноль). true = нужен явный confirm перед сохранением.
 */
export function planWipeRequiresConfirm(
  initialPileRows: number,
  initialDrillingRows: number,
  pilePlans: PilePlanRow[],
  drillingPlans: DrillingPlanRow[],
): boolean {
  const pilesWiped = initialPileRows > 0 && validPileRows(pilePlans).length === 0;
  const drillingWiped = initialDrillingRows > 0 && validDrillingRows(drillingPlans).length === 0;
  return pilesWiped || drillingWiped;
}
