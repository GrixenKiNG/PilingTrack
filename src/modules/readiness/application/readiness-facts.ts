import { checkMaintenanceDue } from '@/lib/maintenance-due';
import type { ReadinessEquipment } from '@/components/piling/to/readiness-model';
import {
  isInspectionRecord,
  isOpenRecord,
  type JournalRecord,
} from '@/components/piling/to/to-stats';
import type { ReadinessFacts } from '../domain/readiness-score';
import { summarizeDefects } from '../domain/defects/defect';
import type { DefectRecord } from '../domain/defects/types';

export interface ReadinessFactsInput {
  equipment: ReadinessEquipment;
  records: JournalRecord[];
  permit?: { valid: boolean; expiresAt?: string | null } | null;
  handoverAccepted?: boolean;
  /**
   * Журнал дефектов установки. Необязателен: пока экран его не передаёт,
   * блокировка определяется по открытым нарядам ремонта, как раньше.
   */
  defects?: readonly Pick<DefectRecord, 'status' | 'severity'>[];
  now?: Date;
}

const REPAIR_TYPES = new Set(['REPAIR', 'FAULT']);

const sameLocalDay = (value: string | null | undefined, now: Date) => {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
};

export function buildReadinessFacts({
  equipment,
  records,
  permit = null,
  handoverAccepted = false,
  defects = [],
  now = new Date(),
}: ReadinessFactsInput): ReadinessFacts {
  const latestInspection = records
    .filter(isInspectionRecord)
    .filter((record) => record.inspection?.status === 'COMPLETED')
    .slice()
    .sort((left, right) =>
      new Date(right.completedAt ?? right.createdAt).getTime()
      - new Date(left.completedAt ?? left.createdAt).getTime())[0] ?? null;
  const inspectionCompleted = latestInspection
    ? sameLocalDay(latestInspection.completedAt ?? latestInspection.createdAt, now)
    : false;
  const healthScore = latestInspection?.inspection?.healthScore ?? null;
  const maintenance = checkMaintenanceDue(equipment, now);

  return {
    inspectionCompleted,
    inspectionProgress: inspectionCompleted ? 1 : latestInspection ? 0.5 : 0,
    healthScore,
    meterKnown: typeof equipment.engineHoursTotal === 'number',
    permitValid: permit ? permit.valid : null,
    permitExpired: Boolean(
      permit
      && !permit.valid
      && permit.expiresAt
      && new Date(permit.expiresAt) < now
    ),
    maintenanceConfigured:
      equipment.nextMaintenanceAtHours != null || equipment.nextMaintenanceDate != null,
    maintenanceOverdueHours: maintenance.overdue ? maintenance.overdueHours ?? 0 : 0,
    maintenanceOverdueDays: maintenance.overdue ? maintenance.overdueDays ?? 0 : 0,
    accepted: handoverAccepted,
    // Блокирует либо открытый критический дефект из журнала, либо, как было
    // до его появления, незакрытый наряд ремонта. Объединение оставлено
    // намеренно: пока не все неисправности заводятся дефектами, снимать
    // старый признак нельзя — иначе часть блокировок пропадёт молча.
    criticalDefect: summarizeDefects(defects).blockingCount > 0
      || records.some((record) => REPAIR_TYPES.has(record.type) && isOpenRecord(record)),
    findings: healthScore != null && healthScore < 100
      ? Math.max(1, Math.round((100 - healthScore) / 10))
      : 0,
  };
}
