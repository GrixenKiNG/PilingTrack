import type { MaintenanceStatus, MaintenancePriority, MaintenanceType } from '@/modules/equipment';

export type { MaintenanceStatus, MaintenancePriority, MaintenanceType };

export const TYPE_LABEL: Record<MaintenanceType, string> = {
  SCHEDULED: 'Плановое ТО', REPAIR: 'Ремонт', FAULT: 'Неисправность', INSPECTION: 'Осмотр',
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
