/**
 * Equipment-card surface template: block catalog keys, default template and
 * validator for the template-driven tile view on /admin/equipment. Pure
 * module (no React) — imported by the server layout service as well.
 *
 * The default template mirrors the hand-built EquipmentTile card: centered
 * brand logo on top, then name/model, status+site, operator+engine hours,
 * today's metrics, maintenance flag and quick links.
 */

import {
  cloneLayoutTemplate,
  createTemplateValidator,
  type LayoutBlock,
  type LayoutBlockStyle,
  type LayoutTemplate,
} from '@/components/piling/layout-editor/layout-template';

export const EQUIPMENT_CARD_DATA_KEYS = [
  'brandLogo',
  'identity',
  'status',
  'site',
  'operator',
  'engineHours',
  'todayPiles',
  'todayDrilling',
  'todayDowntime',
  'maintenanceAlert',
  'quickLinks',
] as const;

export type EquipmentCardDataKey = (typeof EQUIPMENT_CARD_DATA_KEYS)[number];

export interface EquipmentCardBlock extends LayoutBlock {
  dataKey?: EquipmentCardDataKey;
}

export interface EquipmentCardTemplate extends LayoutTemplate {
  blocks: EquipmentCardBlock[];
}

const BASE_STYLE: LayoutBlockStyle = {
  background: '#ffffff',
  color: '#0f172a',
  borderColor: '#e2e8f0',
  borderWidth: 1,
  borderRadius: 12,
  padding: 8,
  fontSize: 12,
  fontWeight: 600,
  textAlign: 'left',
  alignItems: 'center',
};

function dataBlock(
  id: string,
  dataKey: EquipmentCardDataKey,
  x: number,
  y: number,
  width: number,
  height: number,
  style: Partial<LayoutBlockStyle> = {},
): EquipmentCardBlock {
  return {
    id,
    kind: 'data',
    dataKey,
    x,
    y,
    width,
    height,
    visible: true,
    style: { ...BASE_STYLE, ...style },
  };
}

export const DEFAULT_EQUIPMENT_CARD_TEMPLATE: EquipmentCardTemplate = {
  version: 1,
  card: {
    width: 300,
    minHeight: 480,
    rowHeight: 24,
    gap: 8,
    background: '#ffffff',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
  },
  blocks: [
    dataBlock('brand-logo', 'brandLogo', 0, 0, 12, 6, {
      borderWidth: 0,
      background: 'transparent',
      textAlign: 'center',
    }),
    dataBlock('identity', 'identity', 0, 6, 12, 2, { borderWidth: 0, fontSize: 14 }),
    dataBlock('status', 'status', 0, 8, 6, 2),
    dataBlock('site', 'site', 6, 8, 6, 2),
    dataBlock('operator', 'operator', 0, 10, 6, 2),
    dataBlock('engine-hours', 'engineHours', 6, 10, 6, 2),
    dataBlock('today-piles', 'todayPiles', 0, 12, 4, 2),
    dataBlock('today-drilling', 'todayDrilling', 4, 12, 4, 2),
    dataBlock('today-downtime', 'todayDowntime', 8, 12, 4, 2),
    dataBlock('maintenance-alert', 'maintenanceAlert', 0, 14, 12, 2, {
      background: '#fffbeb',
      color: '#92400e',
      borderColor: '#fde68a',
    }),
    dataBlock('quick-links', 'quickLinks', 0, 16, 12, 2, { borderWidth: 0, background: 'transparent' }),
  ],
};

export function cloneEquipmentCardTemplate(template: EquipmentCardTemplate): EquipmentCardTemplate {
  return cloneLayoutTemplate(template);
}

const validate = createTemplateValidator(EQUIPMENT_CARD_DATA_KEYS);

export function validateEquipmentCardTemplate(value: unknown): EquipmentCardTemplate | null {
  return validate(value) as EquipmentCardTemplate | null;
}
