export const DEFECT_SEVERITIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] as const;
export type DefectSeverity = (typeof DEFECT_SEVERITIES)[number];

export const DEFECT_STATUSES = ['OPEN', 'IN_WORK', 'CLOSED', 'REJECTED'] as const;
export type DefectStatus = (typeof DEFECT_STATUSES)[number];

/** Что делают с дефектом: разобрали, устранили, отклонили. */
export type DefectAction = 'TRIAGE' | 'RESOLVE' | 'REJECT';

/**
 * Словарь тот же, что у приоритетов нарядов (PRIORITY_LABEL): в одном модуле
 * не должно быть двух наборов слов для одной и той же шкалы.
 */
export const DEFECT_SEVERITY_LABELS: Record<DefectSeverity, string> = {
  LOW: 'Низкий',
  NORMAL: 'Обычный',
  HIGH: 'Высокий',
  CRITICAL: 'Критичный',
};

/** Что уровень означает на практике — подсказка рядом с выбором. */
export const DEFECT_SEVERITY_HINTS: Record<DefectSeverity, string> = {
  LOW: 'Наблюдение, работе не мешает',
  NORMAL: 'Устранить в плановом порядке',
  HIGH: 'Устранить как можно скорее',
  CRITICAL: 'Эксплуатация запрещена',
};

export const DEFECT_STATUS_LABELS: Record<DefectStatus, string> = {
  OPEN: 'Ждёт разбора',
  IN_WORK: 'В работе',
  CLOSED: 'Устранён',
  REJECTED: 'Отклонён',
};

/** Поля дефекта, от которых зависят доменные решения. */
export interface DefectRecord {
  id: string;
  tenantId: string;
  equipmentId: string;
  severity: DefectSeverity;
  status: DefectStatus;
  title: string;
  node: string | null;
  maintenanceRecordId: string | null;
  version: number;
}

export interface DefectSummary {
  openCount: number;
  blockingCount: number;
  highestSeverity: DefectSeverity | null;
}
