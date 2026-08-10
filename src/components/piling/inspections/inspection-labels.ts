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
  EO: 'bg-muted text-muted-foreground',
  TO1: 'bg-info/10 text-info-strong',
  TO2: 'bg-info/10 text-info-strong',
  TO3: 'bg-violet-100 text-violet-700',
  SEASONAL: 'bg-success/10 text-success-strong',
};

export const STATUS_LABEL: Record<InspectionStatus, string> = {
  DRAFT: 'В процессе',
  COMPLETED: 'Завершён',
};

export const STATUS_STYLE: Record<InspectionStatus, string> = {
  DRAFT: 'bg-warning/10 text-warning-strong',
  COMPLETED: 'bg-success/10 text-success-strong',
};

export function healthScoreColor(score: number | null): string {
  if (score === null) return 'text-muted-foreground';
  if (score >= 90) return 'text-success-strong';
  if (score >= 75) return 'text-warning-strong';
  if (score >= 50) return 'text-warning-strong';
  return 'text-destructive-strong';
}
