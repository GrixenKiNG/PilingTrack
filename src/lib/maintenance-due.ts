/**
 * Shared threshold math for "is this equipment due for maintenance" — by
 * planned date and/or engine-hour threshold. Used by both the fleet-card
 * flag (equipment-maintenance-flag.ts) and the ТО-journal overdue list
 * (to-stats.ts), which previously duplicated this logic independently.
 */

const SOON_DAYS = 7;
const SOON_HOURS = 50;
const DAY_MS = 86_400_000;

export interface MaintenanceDueInput {
  nextMaintenanceDate?: string | null;
  nextMaintenanceAtHours?: number | null;
  engineHoursTotal?: number | null;
}

export interface MaintenanceDueResult {
  overdue: boolean;
  /** Why it is overdue: past planned date, past engine-hour threshold, or both. Null when not overdue. */
  reason: 'date' | 'hours' | 'both' | null;
  /** Whole days past the planned date (>=0), or null when not date-overdue. */
  overdueDays: number | null;
  /** Engine hours past the threshold (>0), or null when not hours-overdue. */
  overdueHours: number | null;
  /** Not yet overdue, but within the SOON window by date or by remaining hours. */
  soon: boolean;
}

export function checkMaintenanceDue(
  input: MaintenanceDueInput,
  now: Date = new Date(),
): MaintenanceDueResult {
  const nowMs = now.getTime();
  const dateMs = input.nextMaintenanceDate != null ? new Date(input.nextMaintenanceDate).getTime() : null;
  const byDate = dateMs != null && dateMs < nowMs;
  const byHours =
    input.nextMaintenanceAtHours != null &&
    input.engineHoursTotal != null &&
    input.engineHoursTotal >= input.nextMaintenanceAtHours;
  const overdue = byDate || byHours;

  let soon = false;
  if (!overdue) {
    if (dateMs != null && (dateMs - nowMs) / DAY_MS <= SOON_DAYS) soon = true;
    if (input.nextMaintenanceAtHours != null && input.engineHoursTotal != null) {
      const left = input.nextMaintenanceAtHours - input.engineHoursTotal;
      if (left >= 0 && left <= SOON_HOURS) soon = true;
    }
  }

  return {
    overdue,
    reason: overdue ? (byDate && byHours ? 'both' : byDate ? 'date' : 'hours') : null,
    overdueDays: byDate && dateMs != null ? Math.floor((nowMs - dateMs) / DAY_MS) : null,
    overdueHours:
      byHours && input.engineHoursTotal != null && input.nextMaintenanceAtHours != null
        ? input.engineHoursTotal - input.nextMaintenanceAtHours
        : null,
    soon,
  };
}
