/** Per-surface layouts: override -> base -> default, with optimistic saves. */
import { db } from '@/lib/db';
import { getSurfaceConfig, type PersistedTemplate, type SurfaceId, type SurfaceTemplateMap } from '../domain/surfaces';

export const BASE_ENTITY = '';
/** An absent row has a revision too: concurrent first saves must conflict. */
export const EMPTY_LAYOUT_REVISION = '"none"';

export class UnknownSurfaceError extends Error {
  constructor(surfaceId: string) {
    super(`Unknown layout surface: ${surfaceId}`);
    this.name = 'UnknownSurfaceError';
  }
}
export class LayoutConflictError extends Error {
  readonly status = 409;
  constructor() {
    super('Раскладка изменена в другой вкладке. Обновите страницу; ваш черновик не сохранён.');
    this.name = 'LayoutConflictError';
  }
}
export interface LayoutSet<T extends PersistedTemplate = PersistedTemplate> {
  base: T;
  overrides: Record<string, T>;
}
export interface LayoutSnapshot<T extends PersistedTemplate = PersistedTemplate> {
  template: T;
  revision: string;
}
function revisionOf(row: { id: string; updatedAt: Date } | null): string {
  return row ? JSON.stringify(row.id + ':' + row.updatedAt.toISOString()) : EMPTY_LAYOUT_REVISION;
}

export function getLayoutSnapshot<S extends SurfaceId>(tenantId: string, surfaceId: S, entityId?: string): Promise<LayoutSnapshot<SurfaceTemplateMap[S]>>;
export function getLayoutSnapshot(tenantId: string, surfaceId: string, entityId?: string): Promise<LayoutSnapshot>;
export async function getLayoutSnapshot(tenantId: string, surfaceId: string, entityId = BASE_ENTITY): Promise<LayoutSnapshot> {
  if (!tenantId) throw new Error('getLayout: tenantId is required');
  const surface = getSurfaceConfig(surfaceId);
  if (!surface) throw new UnknownSurfaceError(surfaceId);
  const own = await db.moduleLayoutTemplate.findUnique({
    where: { tenantId_surfaceId_entityId: { tenantId, surfaceId, entityId } },
  });
  const revision = revisionOf(own);
  const valid = own && surface.validate(own.template);
  if (valid) return { template: valid, revision };
  if (entityId !== BASE_ENTITY) {
    const base = await db.moduleLayoutTemplate.findUnique({
      where: { tenantId_surfaceId_entityId: { tenantId, surfaceId, entityId: BASE_ENTITY } },
    });
    const baseValid = base && surface.validate(base.template);
    if (baseValid) return { template: baseValid, revision };
  }
  return { template: structuredClone(surface.defaultTemplate), revision };
}
export function getLayout<S extends SurfaceId>(tenantId: string, surfaceId: S, entityId?: string): Promise<SurfaceTemplateMap[S]>;
export function getLayout(tenantId: string, surfaceId: string, entityId?: string): Promise<PersistedTemplate>;
export async function getLayout(tenantId: string, surfaceId: string, entityId = BASE_ENTITY): Promise<PersistedTemplate> {
  return (await getLayoutSnapshot(tenantId, surfaceId, entityId)).template;
}
export function getLayoutSet<S extends SurfaceId>(tenantId: string, surfaceId: S): Promise<LayoutSet<SurfaceTemplateMap[S]>>;
export function getLayoutSet(tenantId: string, surfaceId: string): Promise<LayoutSet>;
export async function getLayoutSet(tenantId: string, surfaceId: string): Promise<LayoutSet> {
  if (!tenantId) throw new Error('getLayoutSet: tenantId is required');
  const surface = getSurfaceConfig(surfaceId);
  if (!surface) throw new UnknownSurfaceError(surfaceId);
  const rows = await db.moduleLayoutTemplate.findMany({ where: { tenantId, surfaceId } });
  let base = structuredClone(surface.defaultTemplate);
  const overrides: Record<string, PersistedTemplate> = {};
  for (const row of rows) {
    const valid = surface.validate(row.template);
    if (!valid) continue;
    if (row.entityId === BASE_ENTITY) base = valid;
    else overrides[row.entityId] = valid;
  }
  return { base, overrides };
}

export function saveLayoutSnapshot<S extends SurfaceId>(tenantId: string, surfaceId: S, template: unknown, updatedBy: string, entityId?: string, expectedRevision?: string | null): Promise<LayoutSnapshot<SurfaceTemplateMap[S]>>;
export function saveLayoutSnapshot(tenantId: string, surfaceId: string, template: unknown, updatedBy: string, entityId?: string, expectedRevision?: string | null): Promise<LayoutSnapshot>;
export async function saveLayoutSnapshot(tenantId: string, surfaceId: string, template: unknown, updatedBy: string, entityId = BASE_ENTITY, expectedRevision?: string | null): Promise<LayoutSnapshot> {
  if (!tenantId) throw new Error('saveLayout: tenantId is required');
  const surface = getSurfaceConfig(surfaceId);
  if (!surface) throw new UnknownSurfaceError(surfaceId);
  const validated = surface.validate(template);
  if (!validated) throw new TypeError(`Invalid layout template for surface ${surfaceId}`);
  if (!expectedRevision) throw new LayoutConflictError();
  const scope = { tenantId, surfaceId, entityId };
  const current = await db.moduleLayoutTemplate.findUnique({ where: { tenantId_surfaceId_entityId: scope } });
  if (revisionOf(current) !== expectedRevision) throw new LayoutConflictError();
  if (!current) {
    try {
      const created = await db.moduleLayoutTemplate.create({ data: { ...scope, template: validated as object, updatedBy } });
      return { template: validated, revision: revisionOf(created) };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') throw new LayoutConflictError();
      throw error;
    }
  }
  // Explicit millisecond advance prevents identical revisions on rapid writes.
  const updatedAt = new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1));
  const result = await db.moduleLayoutTemplate.updateMany({
    where: { ...scope, id: current.id, updatedAt: current.updatedAt },
    data: { template: validated as object, updatedBy, updatedAt },
  });
  if (result.count !== 1) throw new LayoutConflictError();
  return { template: validated, revision: revisionOf({ id: current.id, updatedAt }) };
}
export function saveLayout<S extends SurfaceId>(tenantId: string, surfaceId: S, template: unknown, updatedBy: string, entityId?: string, expectedRevision?: string | null): Promise<SurfaceTemplateMap[S]>;
export function saveLayout(tenantId: string, surfaceId: string, template: unknown, updatedBy: string, entityId?: string, expectedRevision?: string | null): Promise<PersistedTemplate>;
export async function saveLayout(tenantId: string, surfaceId: string, template: unknown, updatedBy: string, entityId = BASE_ENTITY, expectedRevision?: string | null): Promise<PersistedTemplate> {
  return (await saveLayoutSnapshot(tenantId, surfaceId, template, updatedBy, entityId, expectedRevision)).template;
}

/** Reset obeys the same revision check as save, including absent scopes. */
export async function deleteLayout(tenantId: string, surfaceId: string, entityId = BASE_ENTITY, expectedRevision?: string | null): Promise<void> {
  if (!tenantId) throw new Error('deleteLayout: tenantId is required');
  if (!getSurfaceConfig(surfaceId)) throw new UnknownSurfaceError(surfaceId);
  const scope = { tenantId, surfaceId, entityId };
  const current = await db.moduleLayoutTemplate.findUnique({ where: { tenantId_surfaceId_entityId: scope } });
  if (!expectedRevision || revisionOf(current) !== expectedRevision) throw new LayoutConflictError();
  if (!current) return;
  const result = await db.moduleLayoutTemplate.deleteMany({ where: { ...scope, id: current.id, updatedAt: current.updatedAt } });
  if (result.count !== 1) throw new LayoutConflictError();
}
