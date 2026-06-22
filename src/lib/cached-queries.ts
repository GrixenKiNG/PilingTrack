/**
 * Cached API Helpers — PilingTrack
 *
 * Provides cached versions of common read API endpoints.
 * Uses Redis cache with automatic invalidation on writes.
 * Implements cache-aside pattern with stampede protection.
 *
 * Cache key patterns:
 *   sites:all          — All sites
 *   sites:{id}         — Single site
 *   crews:all          — All crews
 *   dictionary:{type}  — Dictionary items by type
 *   reports:user:{id}  — Reports for user
 *   report:{id}        — Single report
 *
 * TTL defaults:
 *   Sites/Crews: 5 min
 *   Dictionary: 15 min
 *   Reports: 2 min
 *   Single report: 1 min
 */

import { cacheAside, cacheAsideInvalidate, writeThrough } from '@/lib/cache-strategies';
import { recordDeletion } from '@/lib/cache-metrics';
import { db } from '@/lib/db';

// ============================================================
// Cache TTLs (seconds)
// ============================================================

const TTL = {
  sites: 300,         // 5 min
  crews: 300,         // 5 min
  dictionary: 900,    // 15 min
  reports: 120,       // 2 min
  report: 60,         // 1 min
  equipment: 300,     // 5 min
  telemetry: 30,      // 30 sec
} as const;

// ============================================================
// Sites
// ============================================================

/** Hard cap on the cached "all sites" payload — protects the cache entry
 * (and the response) from ever becoming pathologically large. Callers that
 * legitimately need more must paginate explicitly via a separate endpoint. */
export const SITES_ALL_MAX = 500;

export async function getCachedSitesAll() {
  return cacheAside(
    'sites:all',
    () => db.site.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      take: SITES_ALL_MAX,
    }),
    { ttl: TTL.sites, mutex: true }
  );
}

export async function getCachedSite(id: string) {
  return cacheAside(
    `sites:${id}`,
    () => db.site.findUnique({
      where: { id },
      include: {
        fields: {
          take: 50,
          include: {
            clusters: {
              take: 20,
              include: { pickets: { take: 50 } },
            },
          },
        },
      },
    }),
    { ttl: TTL.sites, mutex: true }
  );
}

// ============================================================
// Crews
// ============================================================

export async function getCachedCrewsAll() {
  return cacheAside(
    'crews:all',
    () => db.crew.findMany({
      where: { isActive: true },
      include: {
        operator: { select: { id: true, name: true } },
        equipment: { select: { id: true, name: true } },
        site: { select: { id: true, name: true, tenantId: true } },
        assistants: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    }),
    { ttl: TTL.crews }
  );
}

// ============================================================
// Dictionary
// ============================================================

export async function getCachedDictionary(
  tenantId: string,
  type: 'pileGrade' | 'drillingType' | 'downtimeReason'
) {
  return cacheAside(
    `dictionary:${tenantId}:${type}`,
    () => {
      const model = type === 'pileGrade' ? db.pileGrade :
                    type === 'drillingType' ? db.drillingType :
                    db.downtimeReason;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
      return (model as any).findMany({
          where: { tenantId, isActive: true },
        orderBy: { name: 'asc' },
      });
    },
    { ttl: TTL.dictionary }
  );
}

export async function getCachedAllDictionaries(tenantId: string) {
  return cacheAside(
    `dictionary:${tenantId}:all`,
    async () => {
      const [pileGrades, drillingTypes, downtimeReasons] = await Promise.all([
        db.pileGrade.findMany({ where: { tenantId, isActive: true }, orderBy: { name: 'asc' } }),
        db.drillingType.findMany({ where: { tenantId, isActive: true }, orderBy: { name: 'asc' } }),
        db.downtimeReason.findMany({ where: { tenantId, isActive: true }, orderBy: { name: 'asc' } }),
      ]);
      return { pileGrades, drillingTypes, downtimeReasons };
    },
    { ttl: TTL.dictionary }
  );
}

// ============================================================
// Reports
// ============================================================

export async function getCachedUserReports(userId: string) {
  return cacheAside(
    `reports:user:${userId}`,
    () => db.report.findMany({
      where: { userId },
      include: {
        site: { select: { name: true } },
        piles: { select: { count: true } },
        drillings: { select: { meters: true } },
        downtimes: { select: { duration: true } },
      },
      orderBy: { date: 'desc' },
      take: 100,
    }),
    { ttl: TTL.reports }
  );
}

export async function getCachedReport(reportId: string) {
  return cacheAside(
    `report:${reportId}`,
    () => db.report.findUnique({
      where: { reportId },
      include: {
        user: { select: { id: true, name: true } },
        site: { select: { id: true, name: true } },
        equipment: { select: { id: true, name: true } },
        crew: {
          select: {
            name: true,
            equipment: { select: { name: true } },
            assistants: { select: { name: true }, take: 10 },
          },
        },
        piles: { include: { pileGrade: true }, take: 100 },
        drillings: { include: { type: true }, take: 100 },
        downtimes: { include: { reason: true }, take: 50 },
      },
    }),
    { ttl: TTL.report }
  );
}

// ============================================================
// Equipment
// ============================================================

export async function getCachedEquipmentAll() {
  return cacheAside(
    'equipment:all',
    () => db.equipment.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    }),
    { ttl: TTL.equipment }
  );
}

// ============================================================
// Cache Invalidation — Call after mutations
// ============================================================

export async function invalidateSites(): Promise<void> {
  await cacheAsideInvalidate('sites:all');
  recordDeletion();
}

export async function invalidateCrews(): Promise<void> {
  await cacheAsideInvalidate('crews:all');
  recordDeletion();
}

export async function invalidateDictionaries(tenantId: string): Promise<void> {
  await cacheAsideInvalidate(`dictionary:${tenantId}:all`);
  recordDeletion();
}

export async function invalidateUserReports(userId: string): Promise<void> {
  await cacheAsideInvalidate(`reports:user:${userId}`);
  recordDeletion();
}

export async function invalidateReport(reportId: string): Promise<void> {
  await cacheAsideInvalidate(`report:${reportId}`);
  recordDeletion();
}

export async function invalidateEquipment(): Promise<void> {
  await cacheAsideInvalidate('equipment:all');
  recordDeletion();
}

/**
 * Write-through update: update DB and cache simultaneously.
 */
export async function updateCachedSite<T>(
  id: string,
  newValue: T,
  updateInDb: () => Promise<void>
): Promise<T> {
  return writeThrough(
    `sites:${id}`,
    newValue,
    updateInDb,
    { ttl: TTL.sites }
  );
}
