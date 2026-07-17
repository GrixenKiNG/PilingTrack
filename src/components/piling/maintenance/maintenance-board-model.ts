/**
 * Типы и чистая презентационная логика журнала нарядов ТО.
 * Выделено из maintenance-board.tsx (аудит A-8: файл был 843 строки).
 */

import { isOverdue, REPAIR_TYPES } from './work-order-logic';
import {
  STATUS_LABEL,
  STATUS_STYLE,
  type MaintenanceStatus,
  type MaintenancePriority,
  type MaintenanceType,
} from './maintenance-labels';

export interface EquipmentCrewSummary {
  id: string;
  name: string;
  operator: { id: string; name: string } | null;
  site: { id: string; name: string } | null;
}

export interface WorkOrderRow {
  id: string;
  equipmentId: string;
  type: MaintenanceType;
  status: MaintenanceStatus;
  priority: MaintenancePriority;
  title: string;
  description: string;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  acceptedAt: string | null;
  assigneeId: string | null;
  faultCause: string | null;
  workDone: string | null;
  partsUsedText: string | null;
  engineHoursAtService: number | null;
  laborHours: number | null;
  cost: string | number | null;
  equipment: {
    id: string;
    name: string;
    model: string | null;
    engineHoursTotal: number | null;
    nextMaintenanceAtHours: number | null;
    nextMaintenanceDate: string | null;
    crews: EquipmentCrewSummary[];
  } | null;
}

export interface AssigneeOption { id: string; name: string }

export interface SiteOption {
  id: string;
  name: string;
}

export interface CrewAssignment {
  id: string;
  name: string;
  isActive: boolean;
  equipmentId: string;
  siteId: string;
  operator: { id: string; name: string } | null;
  equipment: { id: string; name: string } | null;
  site: { id: string; name: string } | null;
}

export type MaintenanceCrewView = EquipmentCrewSummary | CrewAssignment;

export const statusView = (record: WorkOrderRow) => {
  if (isOverdue(record)) return { label: 'Просрочено', className: 'bg-red-50 text-red-700 border-red-200' };
  if (record.status === 'DONE') return { label: 'Готова', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (record.status === 'ON_HOLD' || REPAIR_TYPES.has(record.type)) {
    return { label: 'В ремонте', className: 'bg-blue-50 text-blue-700 border-blue-200' };
  }
  if (record.status === 'IN_PROGRESS') return { label: 'В работе', className: 'bg-blue-50 text-blue-700 border-blue-200' };
  if (record.status === 'CANCELLED') return { label: STATUS_LABEL[record.status], className: STATUS_STYLE[record.status] };
  return { label: 'Требует ТО', className: 'bg-orange-50 text-orange-700 border-orange-200' };
};

export const crewForRecord = (
  record: WorkOrderRow,
  fallback: Map<string, CrewAssignment>,
): MaintenanceCrewView | null => (
  record.equipment?.crews?.[0] ?? fallback.get(record.equipmentId) ?? null
);
