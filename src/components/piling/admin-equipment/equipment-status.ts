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
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  expected: {
    label: 'Ждём отчёт',
    badge: 'bg-orange-50 text-orange-700 border-orange-200',
  },
  missing: {
    label: 'Нет отчёта',
    badge: 'bg-slate-50 text-slate-500 border-slate-200',
  },
};

export const EQUIPMENT_STATUS_META: Record<
  EquipmentOperationalStatus,
  { label: string; badge: string; bar: string }
> = {
  working: {
    label: 'В работе',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    bar: 'bg-emerald-500',
  },
  repair: {
    label: 'Ремонт',
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
    bar: 'bg-blue-500',
  },
  idle: {
    label: 'Простой',
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
    bar: 'bg-amber-500',
  },
};

export const KIND_LABEL: Record<EquipmentKindDTO, string> = {
  PILE_DRIVER: 'Копёр',
  DRILLING_RIG: 'Бур',
  VIBRO_HAMMER: 'Вибро',
  HYBRID: 'Гибрид',
  OTHER: '—',
};
