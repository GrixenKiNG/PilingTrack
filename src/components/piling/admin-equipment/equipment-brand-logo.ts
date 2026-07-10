/**
 * Manufacturer logo for a known Equipment.model.
 *
 * Equipment.model is free text (no normalized manufacturer field on the
 * schema), so this is a small static lookup over Orion's actual fleet models
 * — not a general brand-detection heuristic. Add an entry when a new model
 * joins the fleet; unknown models simply render without a logo.
 */

export interface EquipmentBrand {
  name: string;
  logoSrc: string;
  // Pastel band background for the fleet card header, used when no equipment
  // photo is available for the model (see equipment-photo.ts).
  tint: string;
  // PVE's compact favicon renders at the smaller size, stretched 10% wider;
  // the rest render large (see equipment-tile.tsx).
  compact?: boolean;
  // Backdrop chip behind the logo, for white-on-transparent wordmarks (KBURG)
  // that would otherwise vanish on the white card (see equipment-tile.tsx).
  logoBg?: string;
}

const BRAND_BY_MODEL: Record<string, EquipmentBrand> = {
  'PVE 50PR': { name: 'PVE', logoSrc: '/icons/equipment-brands/pve-usa.png', tint: '#FDECE3', compact: true },
  'SD-20': { name: 'Kopernik', logoSrc: '/icons/equipment-brands/kopernik.png', tint: '#E6F1FB' },
  'Banut 655': { name: 'ABI (Banut)', logoSrc: '/icons/equipment-brands/abi-banut.png', tint: '#FDECE3' },
  'LRH 100': { name: 'Liebherr', logoSrc: '/icons/equipment-brands/liebherr.svg', tint: '#FFF6DA' },
  'RTG RM20': { name: 'RTG Rammtechnik', logoSrc: '/icons/equipment-brands/rtg.svg', tint: '#EAF3DE' },
  'КБУРГ-16': { name: 'КБУРГ', logoSrc: '/icons/equipment-brands/kburg.png', tint: '#FBEAF0', logoBg: '#1f2937' },
};

export function getEquipmentBrand(model: string | null | undefined): EquipmentBrand | null {
  if (!model) return null;
  return BRAND_BY_MODEL[model.trim()] ?? null;
}
