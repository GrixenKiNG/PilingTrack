/**
 * Client-facing shape of the fleet snapshot served by GET /api/monitoring/fleet.
 *
 * Mirrors `FleetCard`/`FleetSnapshot` from the monitoring module but is declared
 * here so client components don't import server code (the service pulls `@/lib/db`).
 * Keep in sync with `fleet-monitoring.service.ts`.
 */

export type EquipmentStatus = 'active' | 'expected' | 'idle';

export type EquipmentKindDTO =
  | 'PILE_DRIVER'
  | 'DRILLING_RIG'
  | 'VIBRO_HAMMER'
  | 'HYBRID'
  | 'OTHER';

export interface FleetCard {
  id: string;
  name: string;
  model: string;
  manufactureYear: number | null;
  kind: EquipmentKindDTO;
  inventoryNumber: string | null;
  serialNumber: string | null;
  engineHoursTotal: number | null;
  nextMaintenanceDate: string | null;
  nextMaintenanceAtHours: number | null;
  assignedSiteName: string | null;
  assignedOperatorName: string | null;
  assignedCrewName: string | null;
  status: EquipmentStatus;
  todaysReports: number;
  todayTotals: {
    piles: number;
    pileMeters: number;
    drillingCount: number;
    drillingMeters: number;
    downtimeHours: number;
  } | null;
  latestReport: {
    date: string;
    siteName: string | null;
    operatorName: string | null;
    shiftType: string;
    updatedAt: string;
  } | null;
}

export interface FleetSnapshot {
  asOf: string;
  today: string;
  totals: {
    totalEquipment: number;
    activeToday: number;
    expected: number;
    idle: number;
    pilesToday: number;
    drillingToday: number;
    downtimeHoursToday: number;
    crewsOnShiftToday: number;
    operatorsOnShiftToday: number;
  };
  equipment: FleetCard[];
}
