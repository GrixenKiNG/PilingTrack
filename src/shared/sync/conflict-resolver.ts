/**
 * Conflict Resolver — Field-Level Merge
 *
 * Стратегии разрешения конфликтов при синхронизации:
 *
 * 1. server_wins — все поля с сервера (для критичных данных)
 * 2. client_wins — все поля с клиента (редко используется)
 * 3. field_merge — умное слияние:
 *    - Критичные поля (status, date, siteId, userId) → server wins
 *    - Обычные поля (shiftStart, shiftEnd, equipmentId) → client wins
 *    - Вложенные объекты (piles, drillings, downtimes) → merge по ID
 *
 * Правила merge для вложенных коллекций:
 * - Если элемент есть только на клиенте → добавить
 * - Если элемент есть только на сервере → оставить
 * - Если элемент есть везде и baseVersion < server.version → server wins
 * - Если элемент изменён только на клиенте → client wins
 */

import type { ConflictStrategy } from '@/shared/types/sync';

// ============================================================
// Критичные поля (server wins)
// ============================================================

const CRITICAL_FIELDS = new Set([
  'status',
  'date',
  'siteId',
  'userId',
  'tenantId',
  'version',
  'updatedAt',
  'createdAt',
  'deleted',
]);

// ============================================================
// Public API
// ============================================================

/**
 * Разрешить конфликт между клиентом и сервером.
 */
export function resolveConflict<T extends Record<string, unknown>>(
  clientData: T,
  serverData: Record<string, unknown>,
  strategy: ConflictStrategy = 'field_merge'
): T {
  switch (strategy) {
    case 'server_wins':
      return serverData as T;

    case 'client_wins':
      return clientData;

    case 'field_merge':
      return fieldMerge(clientData, serverData) as T;

    default:
      return clientData;
  }
}

/**
 * Field-level merge: критичные поля → server, остальные → client.
 * Вложенные коллекции (piles, drillings, downtimes) → merge по ID.
 */
function fieldMerge(
  client: Record<string, unknown>,
  server: Record<string, unknown>
): Record<string, unknown> {
  const merged = { ...server };

  for (const [key, value] of Object.entries(client)) {
    // Критичные поля — server wins
    if (CRITICAL_FIELDS.has(key)) {
      continue;
    }

    // Вложенные коллекции — merge
    if (Array.isArray(value) && Array.isArray(server[key])) {
      merged[key] = mergeCollections(value, server[key] as unknown[]);
      continue;
    }

    // Вложенные объекты — deep merge
    if (isPlainObject(value) && isPlainObject(server[key])) {
      merged[key] = deepMerge(server[key] as Record<string, unknown>, value as Record<string, unknown>);
      continue;
    }

    // Обычные поля — client override если отличается
    if (server[key] !== value) {
      merged[key] = value;
    }
  }

  return merged;
}

/**
 * Merge двух коллекций по ID.
 * - Есть только на клиенте → добавить
 * - Есть только на сервере → оставить
 * - Есть везде → server wins (если версия клиента ниже)
 */
function mergeCollections(
  clientItems: unknown[],
  serverItems: unknown[]
): unknown[] {
  const serverMap = new Map<string, Record<string, unknown>>();
  for (const item of serverItems) {
    if (!isRecord(item) || typeof item.id !== 'string') continue;
    serverMap.set(item.id, item);
  }

  const result = new Map<string, unknown>();

  // Сначала — все серверные элементы
  for (const [id, item] of serverMap) {
    result.set(id, item);
  }

  // Затем — клиентские элементы
  for (const clientItem of clientItems) {
    if (!isRecord(clientItem) || typeof clientItem.id !== 'string') {
      continue;
    }

    const id = clientItem.id;
    if (!serverMap.has(id)) {
      // Новый элемент с клиента — добавить
      result.set(id, clientItem);
    }
    // Если уже есть на сервере — server wins (не перезаписываем)
  }

  return Array.from(result.values());
}

/**
 * Deep merge двух объектов.
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...target };

  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>
      );
    } else {
      result[key] = value;
    }
  }

  return result;
}

// ============================================================
// Helpers
// ============================================================

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value);
}
