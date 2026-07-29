import { checkMaintenanceDue } from '@/lib/maintenance-due';
import {
  type JournalRecord,
  isInspectionRecord,
  isOpenRecord,
  staleOpenOrderDays,
} from './to-stats';

export type ReadinessStatus =
  | 'IN_REPAIR'
  | 'BLOCKED'
  | 'OVERDUE'
  | 'NO_DATA'
  | 'ATTENTION'
  | 'READY';

export type EvidenceState = 'pass' | 'warning' | 'missing' | 'block';

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

export interface ReadinessEvidence {
  key: 'inspection' | 'meter' | 'crew' | 'maintenance' | 'repair';
  label: string;
  value: string;
  state: EvidenceState;
  href?: string;
}

export interface EquipmentReadiness {
  equipmentId: string;
  status: ReadinessStatus;
  canOperate: boolean;
  score: number | null;
  reason: string;
  nextAction: string;
  nextActionHref: string;
  evidence: ReadinessEvidence[];
  latestInspection: JournalRecord | null;
  activeRecord: JournalRecord | null;
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

const recordMoment = (record: JournalRecord) =>
  new Date(record.completedAt ?? record.scheduledAt ?? record.createdAt).getTime();

const latestFirst = (left: JournalRecord, right: JournalRecord) =>
  recordMoment(right) - recordMoment(left);

/**
 * Conservative readiness projection over data that already exists in PilingTrack.
 *
 * It never treats a configured checklist or an empty journal as proof of
 * readiness. READY requires a completed inspection for the current local day,
 * an engine-hour reading, an assigned crew, a configured maintenance threshold
 * and no open repair or overdue maintenance.
 */
export function deriveEquipmentReadiness(
  equipment: ReadinessEquipment,
  records: JournalRecord[],
  journalLoaded: boolean,
  now: Date = new Date(),
): EquipmentReadiness {
  const inspections = records
    .filter(isInspectionRecord)
    .filter((record) => record.inspection?.status === 'COMPLETED')
    .sort(latestFirst);
  const latestInspection = inspections[0] ?? null;
  const inspectedToday = latestInspection
    ? sameLocalDay(latestInspection.completedAt ?? latestInspection.createdAt, now)
    : false;
  const score = latestInspection?.inspection?.healthScore ?? null;

  const activeRepair = records
    .filter((record) => REPAIR_TYPES.has(record.type) && isOpenRecord(record))
    .sort(latestFirst)[0] ?? null;
  const staleAction = records
    .filter((record) => staleOpenOrderDays(record, now) != null)
    .sort(latestFirst)[0] ?? null;
  const overdue = checkMaintenanceDue(equipment, now);
  const meterKnown = typeof equipment.engineHoursTotal === 'number';
  const maintenanceConfigured =
    equipment.nextMaintenanceAtHours != null || equipment.nextMaintenanceDate != null;
  const crewAssigned = equipment.crewCount > 0;

  const inspectionEvidence: ReadinessEvidence = {
    key: 'inspection',
    label: 'Осмотр текущей смены',
    value: !journalLoaded
      ? 'журнал недоступен'
      : inspectedToday
        ? `выполнен${score != null ? ` · ${score}/100` : ''}`
        : latestInspection
          ? 'нет осмотра за сегодня'
          : 'осмотр не найден',
    state: !journalLoaded || !inspectedToday ? 'missing' : score != null && score < 85 ? 'warning' : 'pass',
    href: latestInspection?.inspection
      ? `/inspections/${latestInspection.inspection.id}`
      : `/inspections/new?equipmentId=${equipment.id}`,
  };
  const meterEvidence: ReadinessEvidence = {
    key: 'meter',
    label: 'Наработка',
    value: meterKnown
      ? `${Number(equipment.engineHoursTotal).toLocaleString('ru-RU')} м.ч.`
      : 'нет показания',
    state: meterKnown ? 'pass' : 'missing',
  };
  const crewEvidence: ReadinessEvidence = {
    key: 'crew',
    label: 'Бригада',
    value: crewAssigned ? `назначена · ${equipment.crewCount}` : 'не назначена',
    state: crewAssigned ? 'pass' : 'missing',
  };
  const maintenanceEvidence: ReadinessEvidence = {
    key: 'maintenance',
    label: 'Плановое ТО',
    value: overdue.overdue
      ? overdue.reason === 'both'
        ? 'просрочено по дате и наработке'
        : overdue.reason === 'hours'
          ? `перебег ${overdue.overdueHours ?? 0} м.ч.`
          : `просрочено на ${overdue.overdueDays ?? 0} дн.`
      : maintenanceConfigured
        ? 'срок не нарушен'
        : 'регламент не настроен',
    state: overdue.overdue ? 'block' : maintenanceConfigured ? 'pass' : 'missing',
    href: '/admin/to?view=plans',
  };
  const repairEvidence: ReadinessEvidence = {
    key: 'repair',
    label: 'Ремонт и отказы',
    value: activeRepair ? activeRepair.title : 'активных записей нет',
    state: activeRepair ? 'block' : 'pass',
    href: activeRepair ? '/admin/maintenance' : undefined,
  };
  const evidence = [
    inspectionEvidence,
    meterEvidence,
    crewEvidence,
    maintenanceEvidence,
    repairEvidence,
  ];

  if (activeRepair) {
    return {
      equipmentId: equipment.id,
      status: 'IN_REPAIR',
      canOperate: false,
      score,
      reason: 'Есть открытый ремонт или неисправность.',
      nextAction: 'Открыть ремонтную запись',
      nextActionHref: '/admin/maintenance',
      evidence,
      latestInspection,
      activeRecord: activeRepair,
    };
  }
  if (!equipment.isActive) {
    return {
      equipmentId: equipment.id,
      status: 'BLOCKED',
      canOperate: false,
      score,
      reason: 'Установка выведена из активного парка.',
      nextAction: 'Проверить карточку установки',
      nextActionHref: `/admin/equipment/${equipment.id}`,
      evidence,
      latestInspection,
      activeRecord: null,
    };
  }
  if (overdue.overdue) {
    return {
      equipmentId: equipment.id,
      status: 'OVERDUE',
      canOperate: false,
      score,
      reason: 'Нарушен срок планового обслуживания.',
      nextAction: 'Создать или открыть наряд ТО',
      nextActionHref: '/admin/maintenance',
      evidence,
      latestInspection,
      activeRecord: null,
    };
  }
  if (!journalLoaded || !inspectedToday || !meterKnown || !crewAssigned || !maintenanceConfigured) {
    const missing = evidence.filter((item) => item.state === 'missing').map((item) => item.label);
    return {
      equipmentId: equipment.id,
      status: 'NO_DATA',
      canOperate: false,
      score,
      reason: `Не хватает подтверждений: ${missing.join(', ')}.`,
      nextAction: !inspectedToday
        ? 'Начать осмотр'
        : !meterKnown
          ? 'Добавить показание'
          : !crewAssigned
            ? 'Назначить бригаду'
            : 'Настроить регламент ТО',
      nextActionHref: !inspectedToday
        ? `/inspections/new?equipmentId=${equipment.id}`
        : !meterKnown
          ? '/admin/to?view=meters'
          : !crewAssigned
            ? '/admin/crews'
            : '/admin/to?view=plans',
      evidence,
      latestInspection,
      activeRecord: null,
    };
  }
  if ((score != null && score < 85) || staleAction) {
    return {
      equipmentId: equipment.id,
      status: 'ATTENTION',
      canOperate: false,
      score,
      reason: staleAction
        ? 'Есть незакрытое действие старше 14 дней.'
        : 'Осмотр завершён с замечаниями; требуется решение диспетчера.',
      nextAction: staleAction ? 'Разобрать просроченное действие' : 'Проверить результаты осмотра',
      nextActionHref: staleAction
        ? '/admin/maintenance'
        : latestInspection?.inspection
          ? `/inspections/${latestInspection.inspection.id}`
          : `/inspections/new?equipmentId=${equipment.id}`,
      evidence,
      latestInspection,
      activeRecord: staleAction,
    };
  }
  return {
    equipmentId: equipment.id,
    status: 'READY',
    canOperate: true,
    score,
    reason: 'Критических ограничений нет, обязательные подтверждения собраны.',
    nextAction: 'Открыть журнал установки',
    nextActionHref: '/admin/to?view=journal',
    evidence,
    latestInspection,
    activeRecord: null,
  };
}

export function computeReadinessSummary(items: EquipmentReadiness[]) {
  const ready = items.filter((item) => item.status === 'READY').length;
  const attention = items.filter((item) => item.status === 'ATTENTION').length;
  const blocked = items.filter((item) =>
    ['IN_REPAIR', 'BLOCKED', 'OVERDUE'].includes(item.status)).length;
  const noData = items.filter((item) => item.status === 'NO_DATA').length;
  const readinessPercent = items.length ? Math.round((ready / items.length) * 100) : 0;
  return { total: items.length, ready, attention, blocked, noData, readinessPercent };
}
