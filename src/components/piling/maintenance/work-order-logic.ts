/**
 * Pure work-order (ТО/ремонт) logic — classification, overdue/maintenance math,
 * quick-filter predicate, board KPIs and a couple of string helpers. Extracted
 * from maintenance-board.tsx so the screen carries no business logic and this is
 * unit-testable. Presentation (badges, classNames) stays in the component.
 *
 * Functions take a minimal structural `WorkOrderLike` so callers can pass their
 * richer row type. Date helpers come from @/lib/format (single source).
 */
import { daysUntil, dueText } from '@/lib/format';
import type { MaintenanceStatus, MaintenanceType, MaintenancePriority } from './maintenance-labels';

export type QuickFilter = 'all' | 'requires' | 'overdue' | 'repair' | 'unassigned' | 'issues';

export interface WorkOrderLike {
  status: MaintenanceStatus;
  type: MaintenanceType;
  priority: MaintenancePriority;
  scheduledAt: string | null;
  assigneeId: string | null;
  faultCause: string | null;
  equipmentId: string;
  engineHoursAtService: number | null;
  equipment: { engineHoursTotal: number | null; nextMaintenanceAtHours: number | null } | null;
}

export const OPEN_STATUSES: MaintenanceStatus[] = ['PLANNED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'];
export const REPAIR_TYPES = new Set<MaintenanceType>(['REPAIR', 'FAULT']);
export const REGULAR_TYPES = new Set<MaintenanceType>(['EO', 'TO1', 'TO2', 'TO3', 'SEASONAL', 'SCHEDULED']);

export const isOpenRecord = (record: WorkOrderLike) => OPEN_STATUSES.includes(record.status);

export const isOverdue = (record: WorkOrderLike, now: Date = new Date()) => {
  const days = daysUntil(record.scheduledAt, now);
  return days != null && days < 0 && isOpenRecord(record);
};

export const hoursUntilMaintenance = (record: WorkOrderLike): number | null => {
  const total = record.equipment?.engineHoursTotal;
  const next = record.equipment?.nextMaintenanceAtHours;
  if (typeof total !== 'number' || typeof next !== 'number') return null;
  return next - total;
};

export const currentHours = (record: WorkOrderLike) => (
  record.engineHoursAtService ?? record.equipment?.engineHoursTotal ?? null
);

export const maintenanceInterval = (record: WorkOrderLike) => {
  if (typeof record.equipment?.nextMaintenanceAtHours !== 'number') return null;
  return record.equipment.nextMaintenanceAtHours;
};

/** Russian deadline phrase for a record's scheduled date. */
export const deadlineText = (record: WorkOrderLike, now: Date = new Date()) =>
  dueText(record.scheduledAt, now);

export const quickFilterMatches = (record: WorkOrderLike, filter: QuickFilter, now: Date = new Date()) => {
  if (filter === 'all') return true;
  if (filter === 'requires') return isOpenRecord(record);
  if (filter === 'overdue') return isOverdue(record, now);
  if (filter === 'repair') return REPAIR_TYPES.has(record.type) || record.status === 'ON_HOLD';
  if (filter === 'unassigned') return !record.assigneeId && isOpenRecord(record);
  return record.priority === 'HIGH' || record.priority === 'CRITICAL' || isOverdue(record, now) || Boolean(record.faultCause);
};

export const uniqueEquipmentCount = (records: WorkOrderLike[]) => (
  new Set(records.map((record) => record.equipmentId).filter(Boolean)).size
);

export const maintenanceCompletionPercent = (records: WorkOrderLike[]) => {
  const planned = records.filter((record) => record.status !== 'CANCELLED');
  if (planned.length === 0) return 0;
  const done = planned.filter((record) => record.status === 'DONE').length;
  return Math.round((done / planned.length) * 100);
};

/** "Объект (Площадка)" or "Объект, Площадка" → { title, location }. */
export const splitSiteName = (name: string | null | undefined): { title: string; location: string | null } => {
  const value = name?.trim();
  if (!value) return { title: 'Без объекта', location: null };

  const parenthesized = value.match(/^(.*?)\s*\((.*?)\)\s*$/);
  if (parenthesized?.[1] && parenthesized[2]) {
    return { title: parenthesized[1].trim(), location: parenthesized[2].trim() };
  }

  const [title, ...locationParts] = value.split(',').map((part) => part.trim()).filter(Boolean);
  if (title && locationParts.length > 0) {
    return { title, location: locationParts.join(', ') };
  }

  return { title: value, location: null };
};

/** Windowed page-number list (max 5 buttons) centred on the current page. */
export const visiblePageNumbers = (current: number, total: number): number[] => {
  const maxButtons = 5;
  if (total <= maxButtons) return Array.from({ length: total }, (_, index) => index + 1);

  const start = Math.max(1, Math.min(current - 2, total - maxButtons + 1));
  return Array.from({ length: maxButtons }, (_, index) => start + index);
};

export interface BoardStats {
  equipment: number;
  open: number;
  overdue: number;
  inRepair: number;
  readiness: number;
}

/** Fleet-level ТО KPIs (counts are per distinct rig). */
export function computeBoardStats(
  records: WorkOrderLike[],
  equipmentCount: number,
  now: Date = new Date(),
): BoardStats {
  const activeRecords = records.filter(isOpenRecord);
  const open = uniqueEquipmentCount(activeRecords.filter((record) => REGULAR_TYPES.has(record.type)));
  const overdue = uniqueEquipmentCount(activeRecords.filter((record) => isOverdue(record, now)));
  const inRepair = uniqueEquipmentCount(activeRecords.filter((record) => (
    REPAIR_TYPES.has(record.type) || record.status === 'ON_HOLD'
  )));
  return { equipment: equipmentCount, open, overdue, inRepair, readiness: maintenanceCompletionPercent(records) };
}
