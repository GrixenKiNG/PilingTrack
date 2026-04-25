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
