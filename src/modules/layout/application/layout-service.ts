/**
 * Layout service: per-tenant persisted layout templates for a registered
 * editable surface. A surface has one BASE layout (entityId = '') plus
 * optional per-entity overrides (entityId = the entity's id). A tile resolves
 * to: its own override -> the base -> the surface's hardcoded default.
 */

import { db } from '@/lib/db';
import { getSurfaceConfig, type PersistedTemplate } from '../domain/surfaces';

/** Deep-clone a persisted template (card-blocks grid or page-layout list). */
function cloneTemplate(t: PersistedTemplate): PersistedTemplate {
  return JSON.parse(JSON.stringify(t)) as PersistedTemplate;
}

/** entityId value for the surface-wide base layout. */
export const BASE_ENTITY = '';

export class UnknownSurfaceError extends Error {
  constructor(surfaceId: string) {
    super(`Unknown layout surface: ${surfaceId}`);
    this.name = 'UnknownSurfaceError';
  }
}

export interface LayoutSet {
  base: PersistedTemplate;
  overrides: Record<string, PersistedTemplate>;
}

export async function getLayout(
  tenantId: string,
  surfaceId: string,
  entityId: string = BASE_ENTITY,
): Promise<PersistedTemplate> {
  if (!tenantId) throw new Error('getLayout: tenantId is required'); // fail closed
  const surface = getSurfaceConfig(surfaceId);
  if (!surface) throw new UnknownSurfaceError(surfaceId);

  // Per-entity override wins when present and valid.
  if (entityId !== BASE_ENTITY) {
    const own = await db.moduleLayoutTemplate.findUnique({
      where: { tenantId_surfaceId_entityId: { tenantId, surfaceId, entityId } },
    });
    const ownValid = own && surface.validate(own.template);
    if (ownValid) return ownValid;
  }

  // Fall back to the base layout, then the hardcoded default.
  const base = await db.moduleLayoutTemplate.findUnique({
    where: { tenantId_surfaceId_entityId: { tenantId, surfaceId, entityId: BASE_ENTITY } },
  });
  if (base) return surface.validate(base.template) ?? cloneTemplate(surface.defaultTemplate);
  return cloneTemplate(surface.defaultTemplate);
}

export async function getLayoutSet(tenantId: string, surfaceId: string): Promise<LayoutSet> {
  if (!tenantId) throw new Error('getLayoutSet: tenantId is required'); // fail closed
  const surface = getSurfaceConfig(surfaceId);
  if (!surface) throw new UnknownSurfaceError(surfaceId);
  const rows = await db.moduleLayoutTemplate.findMany({ where: { tenantId, surfaceId } });
  let base = cloneTemplate(surface.defaultTemplate);
  const overrides: Record<string, PersistedTemplate> = {};
  for (const row of rows) {
    const valid = surface.validate(row.template);
    if (!valid) continue;
    if (row.entityId === BASE_ENTITY) base = valid;
    else overrides[row.entityId] = valid;
  }
  return { base, overrides };
}

export async function saveLayout(
  tenantId: string,
  surfaceId: string,
  template: unknown,
  updatedBy: string,
  entityId: string = BASE_ENTITY,
): Promise<PersistedTemplate> {
  if (!tenantId) throw new Error('saveLayout: tenantId is required'); // fail closed
  const surface = getSurfaceConfig(surfaceId);
  if (!surface) throw new UnknownSurfaceError(surfaceId);
  const validated = surface.validate(template);
  if (!validated) throw new TypeError(`Invalid layout template for surface ${surfaceId}`);
  await db.moduleLayoutTemplate.upsert({
    where: { tenantId_surfaceId_entityId: { tenantId, surfaceId, entityId } },
    create: { tenantId, surfaceId, entityId, template: validated as object, updatedBy },
    update: { template: validated as object, updatedBy },
  });
  return validated;
}

/**
 * Remove a saved layout at the given scope. Deleting a per-entity override
 * makes that tile fall back to the base; deleting the base falls back to the
 * hardcoded default. No-op if nothing is saved there.
 */
export async function deleteLayout(
  tenantId: string,
  surfaceId: string,
  entityId: string = BASE_ENTITY,
): Promise<void> {
  if (!tenantId) throw new Error('deleteLayout: tenantId is required'); // fail closed
  const surface = getSurfaceConfig(surfaceId);
  if (!surface) throw new UnknownSurfaceError(surfaceId);
  await db.moduleLayoutTemplate.deleteMany({ where: { tenantId, surfaceId, entityId } });
}
