/**
 * Pure ТО-journal logic — record classification, KPI aggregation and due-date
 * helpers. Extracted from to-module.tsx so the screen carries no business logic
 * and these are unit-testable. Presentation (labels, colours, formatting) stays
 * in the component.
 */

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
  const nowMs = now.getTime();
  const result: OverdueMaintenance[] = [];
  for (const e of equipment) {
    const dateMs = e.nextMaintenanceDate != null ? new Date(e.nextMaintenanceDate).getTime() : null;
    const byDate = dateMs != null && dateMs < nowMs;
    const byHours =
      e.nextMaintenanceAtHours != null &&
      e.engineHoursTotal != null &&
      e.engineHoursTotal >= e.nextMaintenanceAtHours;
    if (!byDate && !byHours) continue;
    result.push({
      id: e.id,
      name: e.name,
      reason: byDate && byHours ? 'both' : byDate ? 'date' : 'hours',
      overdueDays: byDate && dateMs != null ? Math.floor((nowMs - dateMs) / 86_400_000) : null,
      overdueHours:
        byHours && e.engineHoursTotal != null && e.nextMaintenanceAtHours != null
          ? e.engineHoursTotal - e.nextMaintenanceAtHours
          : null,
    });
  }
  return result.sort(
    (a, b) => (b.overdueDays ?? 0) - (a.overdueDays ?? 0) || (b.overdueHours ?? 0) - (a.overdueHours ?? 0),
  );
}
