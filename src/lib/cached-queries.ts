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
import { getResponseCache } from '@/core/cache/response-cache';
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

/**
 * Справочники организации — активные И архивные, с полем `isActive` у каждой записи.
 *
 * Архивированная запись (марка/тип/причина) может быть закреплена за уже сданным
 * отчётом. Если отдавать только активные, форма старого отчёта резолвит её
 * `id` мимо списка и показывает сырой `cuid` вместо названия и 0 м.п. вместо
 * метров (F-R29-2). Поэтому архивные записи тоже отдаются, а фильтр по
 * `isActive` ставят те, кому он нужен: выпадающие списки выбора для новых
 * строк. Разрешение уже сохранённого `id` идёт по полному списку.
 */
export async function getCachedAllDictionaries(tenantId: string) {
  return cacheAside(
    `dictionary:${tenantId}:all`,
    async () => {
      const [pileGrades, drillingTypes, downtimeReasons] = await Promise.all([
        db.pileGrade.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }),
        db.drillingType.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }),
        db.downtimeReason.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }),
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

/**
 * Объект изменился — устарели ОБА слоя кэша.
 *
 * Слоя два: данные (`cacheAside`, ключ `sites:{tenant}:all`) и готовые
 * ответы маршрутов (`withApi({cache: true})`, домен `sites`, TTL 30 с).
 * Сбрасывался только первый, поэтому сразу после сохранения объекта
 * обычный GET ещё полминуты отдавал прежнюю запись — в проверке
 * сохранённые координаты приходили пустыми, а тот же запрос с обходом
 * кэша возвращал верные.
 *
 * Оба слоя чистит одна функция: пока их было два владельца, вызов
 * «сбросить кэш объектов» означал «сбросить половину».
 */
export async function invalidateSites(tenantId: string): Promise<void> {
  await cacheAsideInvalidate(`sites:${tenantId}:all`);
  // Префикс — начало ключа ответа (`${method}:${pathname}`), поэтому одним
  // вызовом снимаются и список, и карточка объекта, и /api/sites/all.
  getResponseCache('sites').invalidate('GET:/api/sites');
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
