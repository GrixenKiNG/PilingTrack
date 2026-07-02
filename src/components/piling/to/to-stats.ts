/**
 * Pure ТО-journal logic — record classification, KPI aggregation and due-date
 * helpers. Extracted from to-module.tsx so the screen carries no business logic
 * and these are unit-testable. Presentation (labels, colours, formatting) stays
 * in the component.
 */

import { checkMaintenanceDue } from '@/lib/maintenance-due';

export interface JournalRecord {
  id: string;
  type: string;
  status: string;
  title: string;
  scheduledAt: string | null;
  completedAt: string | null;
  createdAt: string;
  engineHoursAtService: number | null;
  inspection: { id: string; healthScore: number | null; status: string; level: string } | null;
}

const INSPECTION_TYPES = new Set(['EO', 'TO1', 'TO2', 'TO3', 'SEASONAL', 'INSPECTION']);
const OPEN_STATUSES = new Set(['PLANNED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD']);

export const isInspectionRecord = (record: JournalRecord) => INSPECTION_TYPES.has(record.type);
export const isOpenRecord = (record: JournalRecord) => OPEN_STATUSES.has(record.status);

export interface ToStats {
  inspections: number;
  repairs: number;
  open: number;
  /** Mean inspection healthScore (rounded), or null when none are scored. */
  averageScore: number | null;
}

export function computeToStats(records: JournalRecord[]): ToStats {
  const inspections = records.filter(isInspectionRecord);
  const repairs = records.filter((record) => !isInspectionRecord(record));
  const open = records.filter(isOpenRecord);
  const scores = inspections
    .map((record) => record.inspection?.healthScore)
    .filter((score): score is number => typeof score === 'number');
  const averageScore = scores.length
    ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
    : null;
  return { inspections: inspections.length, repairs: repairs.length, open: open.length, averageScore };
}

// daysUntil / dueText are generic date helpers — canonical in @/lib/format.
// Re-exported so to-module keeps a single import surface.
export { daysUntil, dueText } from '@/lib/format';

/** Minimal equipment shape needed to judge maintenance overdue-ness. */
export interface MaintenanceCandidate {
  id: string;
  name: string;
  engineHoursTotal?: number | null;
  nextMaintenanceAtHours?: number | null;
  nextMaintenanceDate?: string | null;
}

export interface OverdueMaintenance {
  id: string;
  name: string;
  /** Why it is overdue: past planned date, past engine-hour threshold, or both. */
  reason: 'date' | 'hours' | 'both';
  /** Whole days past the planned date (>=0), or null when not date-overdue. */
  overdueDays: number | null;
  /** Engine hours past the threshold (>0), or null when not hours-overdue. */
  overdueHours: number | null;
}

/**
 * Read-model: equipment whose maintenance is overdue, derived purely from the
 * already-loaded equipment list — no new query, no schema. Overdue by planned
 * date and/or engine-hour threshold. `now` is injected for testability.
 * Sorted most-overdue first.
 */
export function findOverdueMaintenance(
  equipment: MaintenanceCandidate[],
  now: Date = new Date(),
): OverdueMaintenance[] {
  const result: OverdueMaintenance[] = [];
  for (const e of equipment) {
    const due = checkMaintenanceDue(e, now);
    if (!due.overdue) continue;
    result.push({
      id: e.id,
      name: e.name,
      // checkMaintenanceDue only sets reason to null when !overdue, which is excluded above.
      reason: due.reason as 'date' | 'hours' | 'both',
      overdueDays: due.overdueDays,
      overdueHours: due.overdueHours,
    });
  }
  return result.sort(
    (a, b) => (b.overdueDays ?? 0) - (a.overdueDays ?? 0) || (b.overdueHours ?? 0) - (a.overdueHours ?? 0),
  );
}

/** Open work orders/inspections older than this are flagged as stale. */
export const STALE_OPEN_ORDER_DAYS = 14;

const OPEN_ORDER_TERMINAL = new Set(['DONE', 'CANCELLED']);

/**
 * Days an order has been sitting open, or null when it's closed / younger
 * than the staleness threshold. Open orders used to live "В работе" forever
 * with no visual difference from fresh ones, so the journal stopped being a
 * signal (10+ inspections «В процессе» from weeks ago looked normal).
 */
export function staleOpenOrderDays(
  order: { status: string; createdAt: string | Date | null | undefined },
  now: Date = new Date(),
): number | null {
  if (OPEN_ORDER_TERMINAL.has(order.status)) return null;
  if (!order.createdAt) return null;
  const created = order.createdAt instanceof Date ? order.createdAt : new Date(order.createdAt);
  if (Number.isNaN(created.getTime())) return null;
  const days = Math.floor((now.getTime() - created.getTime()) / 86_400_000);
  return days >= STALE_OPEN_ORDER_DAYS ? days : null;
}

/** Minimal equipment shape needed to judge crew coverage. */
export interface CrewCandidate {
  id: string;
  name: string;
  isActive: boolean;
  crewCount: number;
}

/**
 * Read-model: active equipment with no active crew assigned — derived purely
 * from the already-loaded equipment list. No new query, no schema.
 */
export function findUncrewedEquipment(equipment: CrewCandidate[]): CrewCandidate[] {
  return equipment.filter((e) => e.isActive && e.crewCount === 0);
}
