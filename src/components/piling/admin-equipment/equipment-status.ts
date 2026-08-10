/**
 * Presentation metadata for the report-presence status used across the fleet
 * center. Status itself is computed server-side in getFleetSnapshot.
 */
import type {
  EquipmentOperationalStatus,
  EquipmentStatus,
  EquipmentKindDTO,
  ReportStatus,
} from './fleet-types';

export const STATUS_META: Record<
  EquipmentStatus,
  { label: string; badge: string; bar: string }
> = {
  active: {
    label: 'В работе',
    badge: 'bg-success/10 text-success border-success/20',
    bar: 'bg-success',
  },
  expected: {
    label: 'Ожидается',
    badge: 'bg-info/10 text-info border-info/20',
    bar: 'bg-info',
  },
  idle: {
    label: 'Простой',
    badge: 'bg-warning/10 text-warning border-warning/20',
    bar: 'bg-warning',
  },
};

export const REPORT_STATUS_META: Record<ReportStatus, { label: string; badge: string }> = {
  has_report: {
    label: 'Есть отчёт',
    badge: 'bg-success/10 text-success-strong border-success/30',
  },
  expected: {
    label: 'Ждём отчёт',
    badge: 'bg-warning/10 text-warning-strong border-warning/30',
  },
  missing: {
    label: 'Нет отчёта',
    badge: 'bg-muted text-muted-foreground border-border',
  },
};

export const EQUIPMENT_STATUS_META: Record<
  EquipmentOperationalStatus,
  { label: string; badge: string; bar: string }
> = {
  working: {
    label: 'В работе',
    badge: 'bg-success/10 text-success-strong border-success/30',
    bar: 'bg-success-strong',
  },
  repair: {
    label: 'Ремонт',
    badge: 'bg-info/10 text-info-strong border-info/30',
    bar: 'bg-info-strong',
  },
  idle: {
    label: 'Простой',
    badge: 'bg-warning/10 text-warning-strong border-warning/30',
    bar: 'bg-warning-strong',
  },
};

export const KIND_LABEL: Record<EquipmentKindDTO, string> = {
  PILE_DRIVER: 'Копёр',
  DRILLING_RIG: 'Бур',
  VIBRO_HAMMER: 'Вибро',
  HYBRID: 'Гибрид',
  OTHER: '—',
};
