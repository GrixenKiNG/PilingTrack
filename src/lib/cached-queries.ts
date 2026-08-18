/**
 * Cached API Helpers — PilingTrack
 *
 * Provides cached versions of common read API endpoints.
 * Uses Redis cache with automatic invalidation on writes.
 * Implements cache-aside pattern with stampede protection.
 *
 * Cache key patterns:
 *   crews:all          — All crews
 *   dictionary:{type}  — Dictionary items by type
 *
 * TTL defaults:
 *   Crews: 5 min
 *   Dictionary: 15 min
 */

import { cacheAside, cacheAsideInvalidate } from '@/lib/cache-strategies';
import { recordDeletion } from '@/lib/cache-metrics';
import { db } from '@/lib/db';

// ============================================================
// Cache TTLs (seconds)
// ============================================================

const TTL = {
  crews: 300,         // 5 min
  dictionary: 900,    // 15 min
} as const;


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
// Equipment
// ============================================================

// getCachedEquipmentAll удалена вместе с маршрутом GET /api/equipment/all.
// Запрос не фильтровал по тенанту и клал результат под общий ключ
// 'equipment:all': любой аутентифицированный пользователь получал парк всех
// организаций, а общий ключ кэша протащил бы утечку даже после починки
// условия. Потребителей у маршрута не было; парк отдаёт GET /api/equipment,
// где tenantId в условии.

// ============================================================
// Cache Invalidation — Call after mutations
// ============================================================

export async function invalidateSites(tenantId: string): Promise<void> {
  await cacheAsideInvalidate(`sites:${tenantId}:all`);
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
