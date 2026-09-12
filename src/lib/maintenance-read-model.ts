/** Shared maintenance facts and classification; independent of UI and database access. */

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

export interface ReadinessEquipment {
  id: string;
  name: string;
  model: string | null;
  isActive: boolean;
  crewCount: number;
  engineHoursTotal?: number | null;
  nextMaintenanceAtHours?: number | null;
  nextMaintenanceDate?: string | null;
}

