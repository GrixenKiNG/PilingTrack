export type InspectionLevel = 'EO' | 'TO1' | 'TO2' | 'TO3' | 'SEASONAL';
export type InspectionStatus = 'DRAFT' | 'COMPLETED';

export const LEVEL_LABEL: Record<InspectionLevel, string> = {
  EO: 'ЕО',
  TO1: 'ТО-1',
  TO2: 'ТО-2',
  TO3: 'ТО-3',
  SEASONAL: 'Сезонное',
};

export const LEVEL_STYLE: Record<InspectionLevel, string> = {
  EO: 'bg-slate-100 text-slate-600',
  TO1: 'bg-sky-100 text-sky-700',
  TO2: 'bg-blue-100 text-blue-700',
  TO3: 'bg-violet-100 text-violet-700',
  SEASONAL: 'bg-emerald-100 text-emerald-700',
};

export const STATUS_LABEL: Record<InspectionStatus, string> = {
  DRAFT: 'В процессе',
  COMPLETED: 'Завершён',
};

export const STATUS_STYLE: Record<InspectionStatus, string> = {
  DRAFT: 'bg-amber-100 text-amber-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
};

export function healthScoreColor(score: number | null): string {
  if (score === null) return 'text-slate-400';
  if (score >= 90) return 'text-emerald-600';
  if (score >= 75) return 'text-amber-600';
  if (score >= 50) return 'text-orange-600';
  return 'text-rose-600';
}
