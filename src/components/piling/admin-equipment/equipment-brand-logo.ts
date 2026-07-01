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
}

const BRAND_BY_MODEL: Record<string, EquipmentBrand> = {
  'PVE 50PR': { name: 'PVE', logoSrc: '/icons/equipment-brands/pve.png' },
  'SD-20': { name: 'Kopernik', logoSrc: '/icons/equipment-brands/kopernik.png' },
  'Banut 655': { name: 'ABI (Banut)', logoSrc: '/icons/equipment-brands/abi-banut.png' },
  'LRH 100': { name: 'Liebherr', logoSrc: '/icons/equipment-brands/liebherr.svg' },
  'RTG RM20': { name: 'RTG Rammtechnik', logoSrc: '/icons/equipment-brands/rtg.svg' },
  'КБУРГ-16': { name: 'БашСтрой', logoSrc: '/icons/equipment-brands/bashstroy.png' },
};

export function getEquipmentBrand(model: string | null | undefined): EquipmentBrand | null {
  if (!model) return null;
  return BRAND_BY_MODEL[model.trim()] ?? null;
}
