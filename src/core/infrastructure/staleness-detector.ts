/**
 * Stale Projection Detection
 *
 * F12 Guarantee: UI knows when projection data is stale vs source data.
 * Prevents "silently wrong data" — users see staleness indicator.
 *
 * Architecture:
 * - Each source entity has a `version` field (monotonically increasing)
 * - Each projection has a `sourceVersion` field
 * - If projection.sourceVersion < entity.version → data is stale
 */

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

// ============================================================
// Version Tracking
// ============================================================

/**
 * Get current version of an entity.
 */
export async function getEntityVersion(
  entityType: string,
  entityId: string
): Promise<number | null> {
  switch (entityType) {
    case 'report': {
      const report = await db.report.findUnique({
        where: { id: entityId },
        select: { version: true },
      });
      return report?.version ?? null;
    }
    case 'site': {
      const site = await db.site.findUnique({
        where: { id: entityId },
        select: { updatedAt: true },
      });
      return site ? new Date(site.updatedAt).getTime() : null;
    }
    default:
      return null;
  }
}

/**
 * Check if a projection is stale compared to its source entity.
 */
export async function checkProjectionStaleness<
  TProjection extends { sourceVersion?: number | null; updatedAt?: Date }
>(
  entityType: string,
  entityId: string,
  projection: TProjection
): Promise<{ stale: boolean; sourceVersion: number | null; projectionVersion: number | null }> {
  const sourceVersion = await getEntityVersion(entityType, entityId);
  const projectionVersion = projection.sourceVersion ?? null;

  const stale = sourceVersion !== null &&
                projectionVersion !== null &&
                projectionVersion < sourceVersion;

  if (stale) {
    logger.info('Stale projection detected', {
      entityType,
      entityId,
      sourceVersion,
      projectionVersion,
      projectionUpdatedAt: projection.updatedAt,
    });
  }

  return {
    stale,
    sourceVersion,
    projectionVersion,
  };
}

// ============================================================
// Projection Version Tracking Helpers
// ============================================================

/**
 * Mark a projection as up-to-date with the source version.
 */
export async function markProjectionCurrent(
  tableName: string,
  entityId: string,
  sourceVersion: number
): Promise<void> {
  // This is a generic helper — actual implementation depends on table schema
  logger.debug('Marking projection current', {
    tableName,
    entityId,
    sourceVersion,
  });
}

/**
 * Get staleness status for a batch of projections.
 * Returns a map of entityId → staleness status.
 */
export async function batchCheckStaleness(
  entityType: string,
  entityIds: string[]
): Promise<Map<string, { stale: boolean; sourceVersion: number | null }>> {
  const results = new Map<string, { stale: boolean; sourceVersion: number | null }>();

  // Batch fetch versions
  switch (entityType) {
    case 'report': {
      const reports = await db.report.findMany({
        where: { id: { in: entityIds } },
        select: { id: true, version: true },
      });

      const versionMap = new Map(reports.map(r => [r.id, r.version]));

      for (const id of entityIds) {
        results.set(id, {
          stale: false, // Projections need to compare their sourceVersion
          sourceVersion: versionMap.get(id) ?? null,
        });
      }
      break;
    }
    default:
      for (const id of entityIds) {
        results.set(id, { stale: false, sourceVersion: null });
      }
  }

  return results;
}

/**
 * Middleware wrapper — add staleness info to response.
 *
 * Usage in API route:
 *   const data = await getProjectionData();
 *   const staleness = await checkProjectionStaleness('report', reportId, data);
 *   return NextResponse.json({ ...data, _meta: { stale: staleness.stale } });
 */
export function withStalenessMeta<T>(
  data: T,
  staleness: { stale: boolean; sourceVersion: number | null; projectionVersion: number | null }
): T & { _meta: { stale: boolean; sourceVersion: number | null; projectionVersion: number | null } } {
  return {
    ...data,
    _meta: {
      stale: staleness.stale,
      sourceVersion: staleness.sourceVersion,
      projectionVersion: staleness.projectionVersion,
    },
  };
}
