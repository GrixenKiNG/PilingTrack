import type { MaintenanceStatus, MaintenancePriority, MaintenanceType } from '@/modules/equipment';

export type { MaintenanceStatus, MaintenancePriority, MaintenanceType };

export const TYPE_LABEL: Record<MaintenanceType, string> = {
  EO: 'ЕО',
  TO1: 'ТО-1',
  TO2: 'ТО-2',
  TO3: 'ТО-3',
  SEASONAL: 'Сезонное',
  REPAIR: 'Ремонт',
  FAULT: 'Неисправность',
  SCHEDULED: 'Плановое ТО',
  INSPECTION: 'Осмотр',
};
export const STATUS_LABEL: Record<MaintenanceStatus, string> = {
  PLANNED: 'Запланировано', ASSIGNED: 'Назначено', IN_PROGRESS: 'В работе',
  ON_HOLD: 'Приостановлено', DONE: 'Выполнено', CANCELLED: 'Отменено',
};
export const STATUS_STYLE: Record<MaintenanceStatus, string> = {
  PLANNED: 'bg-muted text-muted-foreground',
  ASSIGNED: 'bg-info/10 text-info-strong',
  IN_PROGRESS: 'bg-warning/10 text-warning-strong',
  ON_HOLD: 'bg-warning/10 text-warning-strong',
  DONE: 'bg-success/10 text-success-strong',
  CANCELLED: 'bg-muted text-muted-foreground line-through',
};
export const PRIORITY_LABEL: Record<MaintenancePriority, string> = {
  LOW: 'Низкий', NORMAL: 'Обычный', HIGH: 'Высокий', CRITICAL: 'Критичный',
};
export const PRIORITY_STYLE: Record<MaintenancePriority, string> = {
  LOW: 'bg-muted text-muted-foreground',
  NORMAL: 'bg-muted text-muted-foreground',
  HIGH: 'bg-warning/10 text-warning-strong',
  CRITICAL: 'bg-destructive/10 text-destructive-strong',
};

export const TYPE_STYLE: Record<MaintenanceType, string> = {
  EO: 'bg-muted text-muted-foreground',
  TO1: 'bg-info/10 text-info-strong',
  TO2: 'bg-info/10 text-info-strong',
  TO3: 'bg-info/10 text-info-strong',
  SEASONAL: 'bg-info/10 text-info-strong',
  REPAIR: 'bg-destructive/10 text-destructive-strong',
  FAULT: 'bg-warning/10 text-warning-strong',
  SCHEDULED: 'bg-info/10 text-info-strong',
  INSPECTION: 'bg-muted text-muted-foreground',
};

export const MAINTENANCE_TYPE_OPTIONS: MaintenanceType[] = [
  'EO',
  'TO1',
  'TO2',
  'TO3',
  'SEASONAL',
  'REPAIR',
  'FAULT',
  'SCHEDULED',
  'INSPECTION',
];
