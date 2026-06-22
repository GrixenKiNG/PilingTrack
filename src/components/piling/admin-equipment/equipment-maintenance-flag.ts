/**
 * Maintenance indicator for a fleet card — a secondary badge layered on top of
 * the report-presence status. Pure function so it can be unit-tested without a
 * render. Thresholds are module constants; tweak here.
 */

import type { FleetCard } from './fleet-types';

const SOON_DAYS = 7;
const SOON_HOURS = 50;
const DAY_MS = 86_400_000;

export type MaintenanceFlag = 'overdue' | 'soon' | null;

export function getMaintenanceFlag(
  card: Pick<FleetCard, 'nextMaintenanceDate' | 'nextMaintenanceAtHours' | 'engineHoursTotal'>,
  now: Date = new Date(),
): MaintenanceFlag {
  const due = card.nextMaintenanceDate ? new Date(card.nextMaintenanceDate) : null;
  const overByHours =
    card.nextMaintenanceAtHours != null &&
    card.engineHoursTotal != null &&
    card.engineHoursTotal >= card.nextMaintenanceAtHours;

  if ((due && due.getTime() < now.getTime()) || overByHours) return 'overdue';

  if (due && (due.getTime() - now.getTime()) / DAY_MS <= SOON_DAYS) return 'soon';

  if (card.nextMaintenanceAtHours != null && card.engineHoursTotal != null) {
    const left = card.nextMaintenanceAtHours - card.engineHoursTotal;
    if (left >= 0 && left <= SOON_HOURS) return 'soon';
  }

  return null;
}
