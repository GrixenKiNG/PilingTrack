/**
 * Layout service: per-tenant persisted layout template for a registered
 * editable surface. Generalization of the former monitoring template-service
 * — one row per (tenant, surface) in ModuleLayoutTemplate.
 */

import { db } from '@/lib/db';
import { cloneLayoutTemplate, type LayoutTemplate } from '@/components/piling/layout-editor/layout-template';
import { getSurfaceConfig } from '../domain/surfaces';

export class UnknownSurfaceError extends Error {
  constructor(surfaceId: string) {
    super(`Unknown layout surface: ${surfaceId}`);
    this.name = 'UnknownSurfaceError';
  }
}

export async function getLayout(tenantId: string, surfaceId: string): Promise<LayoutTemplate> {
  if (!tenantId) throw new Error('getLayout: tenantId is required'); // fail closed
  const surface = getSurfaceConfig(surfaceId);
  if (!surface) throw new UnknownSurfaceError(surfaceId);
  const row = await db.moduleLayoutTemplate.findUnique({
    where: { tenantId_surfaceId: { tenantId, surfaceId } },
  });
  if (!row) return cloneLayoutTemplate(surface.defaultTemplate);
  return surface.validate(row.template) ?? cloneLayoutTemplate(surface.defaultTemplate);
}

export async function saveLayout(
  tenantId: string,
  surfaceId: string,
  template: unknown,
  updatedBy: string,
): Promise<LayoutTemplate> {
  if (!tenantId) throw new Error('saveLayout: tenantId is required'); // fail closed
  const surface = getSurfaceConfig(surfaceId);
  if (!surface) throw new UnknownSurfaceError(surfaceId);
  const validated = surface.validate(template);
  if (!validated) throw new TypeError(`Invalid layout template for surface ${surfaceId}`);
  await db.moduleLayoutTemplate.upsert({
    where: { tenantId_surfaceId: { tenantId, surfaceId } },
    create: { tenantId, surfaceId, template: validated as object, updatedBy },
    update: { template: validated as object, updatedBy },
  });
  return validated;
}
