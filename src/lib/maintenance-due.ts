/**
 * Shared threshold math for "is this equipment due for maintenance" — by
 * planned date and/or engine-hour threshold. Used by both the fleet-card
 * flag (equipment-maintenance-flag.ts) and the ТО-journal overdue list
 * (to-stats.ts), which previously duplicated this logic independently.
 */

import { daysUntil } from '@/lib/format';

const SOON_DAYS = 7;
const SOON_HOURS = 50;

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
  // Planned maintenance is a calendar date, valid through the current production day.
  const daysLeft = daysUntil(input.nextMaintenanceDate, now);
  const byDate = daysLeft != null && daysLeft < 0;
  const byHours =
    input.nextMaintenanceAtHours != null &&
    input.engineHoursTotal != null &&
    input.engineHoursTotal >= input.nextMaintenanceAtHours;
  const overdue = byDate || byHours;

  let soon = false;
  if (!overdue) {
    if (daysLeft != null && daysLeft <= SOON_DAYS) soon = true;
    if (input.nextMaintenanceAtHours != null && input.engineHoursTotal != null) {
      const left = input.nextMaintenanceAtHours - input.engineHoursTotal;
      if (left >= 0 && left <= SOON_HOURS) soon = true;
    }
  }

  return {
    overdue,
    reason: overdue ? (byDate && byHours ? 'both' : byDate ? 'date' : 'hours') : null,
    overdueDays: byDate && daysLeft != null ? -daysLeft : null,
    overdueHours:
      byHours && input.engineHoursTotal != null && input.nextMaintenanceAtHours != null
        ? input.engineHoursTotal - input.nextMaintenanceAtHours
        : null,
    soon,
  };
}
