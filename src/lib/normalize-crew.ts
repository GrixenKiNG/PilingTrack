/**
 * Normalize crew data from various sources (DB crew, fallback crew, report.crew).
 *
 * Solves the TypeScript union type mismatch where effectiveCrew can be:
 *   - { name?: string } (lightweight fallback)
 *   - { operatorId: string; siteId: string; assistants?: ...; equipment?: ... } (Prisma select)
 *   - Full Crew entity from report.crew relation
 *
 * Returns a consistent shape safe for PDF generation / UI rendering.
 */

export interface NormalizedCrewData {
  assistantName: string;
  equipmentName: string;
}

/**
 * Normalize any crew-like object into a consistent shape.
 * Handles: Prisma select results, Crew entities, partial DTOs, null/undefined.
 */
export function normalizeCrewData(crew: unknown): NormalizedCrewData {
  const c = crew as Record<string, unknown> | null | undefined;

  const assistants = Array.isArray(c?.assistants)
    ? (c.assistants as { name?: string }[])
        .map(a => a.name ?? '')
        .filter(name => name.length > 0)
    : [];

  const equipmentName =
    typeof c?.equipment === 'object' && c?.equipment !== null
      ? (c.equipment as { name?: string }).name ?? ''
      : '';

  return {
    assistantName: assistants.join(', '),
    equipmentName,
  };
}
