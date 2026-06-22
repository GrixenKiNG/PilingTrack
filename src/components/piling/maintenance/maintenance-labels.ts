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
  PLANNED: 'bg-slate-100 text-slate-600',
  ASSIGNED: 'bg-sky-100 text-sky-700',
  IN_PROGRESS: 'bg-amber-100 text-amber-700',
  ON_HOLD: 'bg-orange-100 text-orange-700',
  DONE: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-slate-100 text-slate-400 line-through',
};
export const PRIORITY_LABEL: Record<MaintenancePriority, string> = {
  LOW: 'Низкий', NORMAL: 'Обычный', HIGH: 'Высокий', CRITICAL: 'Критичный',
};
export const PRIORITY_STYLE: Record<MaintenancePriority, string> = {
  LOW: 'bg-slate-100 text-slate-500',
  NORMAL: 'bg-slate-100 text-slate-600',
  HIGH: 'bg-amber-100 text-amber-700',
  CRITICAL: 'bg-rose-100 text-rose-700',
};

export const TYPE_STYLE: Record<MaintenanceType, string> = {
  EO: 'bg-slate-100 text-slate-600',
  TO1: 'bg-blue-100 text-blue-700',
  TO2: 'bg-blue-100 text-blue-700',
  TO3: 'bg-indigo-100 text-indigo-700',
  SEASONAL: 'bg-cyan-100 text-cyan-700',
  REPAIR: 'bg-rose-100 text-rose-700',
  FAULT: 'bg-amber-100 text-amber-700',
  SCHEDULED: 'bg-blue-100 text-blue-700',
  INSPECTION: 'bg-slate-100 text-slate-600',
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
