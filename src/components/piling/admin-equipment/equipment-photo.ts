/**
 * Real photo for a known Equipment.model, shown as the fleet card's header
 * band background. Same free-text-model caveat as equipment-brand-logo.ts —
 * not every model has a photo yet; those fall back to the brand tint.
 */

const PHOTO_BY_MODEL: Record<string, string> = {
  'PVE 50PR': '/icons/equipment-photos/pve-50pr.jpg',
  'Banut 655': '/icons/equipment-photos/banut-655.jpg',
  'LRH 100': '/icons/equipment-photos/liebherr-lrh100.jpg',
  'RTG RM20': '/icons/equipment-photos/rtg-rm20.jpg',
};

export function getEquipmentPhoto(model: string | null | undefined): string | null {
  if (!model) return null;
  return PHOTO_BY_MODEL[model.trim()] ?? null;
}
