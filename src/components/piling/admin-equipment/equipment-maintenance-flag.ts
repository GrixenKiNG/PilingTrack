/**
 * Maintenance indicator for a fleet card — a secondary badge layered on top of
 * the report-presence status. Pure function so it can be unit-tested without a
 * render. Threshold math lives in @/lib/maintenance-due (shared with the
 * ТО-journal overdue list).
 */

import type { FleetCard } from './fleet-types';
import { checkMaintenanceDue } from '@/lib/maintenance-due';

export type MaintenanceFlag = 'overdue' | 'soon' | null;

export function getMaintenanceFlag(
  card: Pick<FleetCard, 'nextMaintenanceDate' | 'nextMaintenanceAtHours' | 'engineHoursTotal'>,
  now: Date = new Date(),
): MaintenanceFlag {
  const result = checkMaintenanceDue(card, now);
  if (result.overdue) return 'overdue';
  if (result.soon) return 'soon';
  return null;
}
