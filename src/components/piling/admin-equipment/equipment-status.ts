/**
 * Presentation metadata for the report-presence status used across the fleet
 * center. Status itself is computed server-side in getFleetSnapshot.
 */
import type { EquipmentStatus, EquipmentKindDTO } from './fleet-types';

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

export const KIND_LABEL: Record<EquipmentKindDTO, string> = {
  PILE_DRIVER: 'Копёр',
  DRILLING_RIG: 'Бур',
  VIBRO_HAMMER: 'Вибро',
  HYBRID: 'Гибрид',
  OTHER: '—',
};
