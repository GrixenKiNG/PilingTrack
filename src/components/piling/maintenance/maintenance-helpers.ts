import type { MaintenanceStatus, MaintenancePriority, MaintenanceType } from './maintenance-labels';

export interface MaintenanceFilter {
  status?: MaintenanceStatus | '';
  priority?: MaintenancePriority | '';
  assigneeId?: string;
  type?: MaintenanceType | '';
}

export function buildMaintenanceQuery(filter: MaintenanceFilter): string {
  const sp = new URLSearchParams();
  if (filter.status) sp.set('status', filter.status);
  if (filter.priority) sp.set('priority', filter.priority);
  if (filter.assigneeId) sp.set('assigneeId', filter.assigneeId);
  if (filter.type) sp.set('type', filter.type);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function resolveAssigneeName(id: string | null, names: Map<string, string>): string {
  if (!id) return '—';
  return names.get(id) ?? '—';
}

const TRANSITIONS: Record<MaintenanceStatus, MaintenanceStatus[]> = {
  PLANNED: ['IN_PROGRESS', 'CANCELLED'],
  ASSIGNED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['ON_HOLD', 'DONE', 'CANCELLED'],
  ON_HOLD: ['IN_PROGRESS', 'CANCELLED'],
  DONE: [],
  CANCELLED: [],
};

export function nextStatusActions(status: MaintenanceStatus): MaintenanceStatus[] {
  return TRANSITIONS[status] ?? [];
}
