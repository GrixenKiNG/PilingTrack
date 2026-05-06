import { isRecord } from './helpers';

/**
 * Merge piles: union by pileGradeId, take max count.
 *
 * If client and server both added piles with same grade, they're likely
 * reporting the same work — take the higher count. If only one side has
 * a pile grade, include it.
 */
export function mergePiles(client: unknown[], server: unknown[]): unknown[] {
  const serverMap = new Map<string, Record<string, unknown>>();
  const clientMap = new Map<string, Record<string, unknown>>();

  for (const item of server) {
    if (isRecord(item) && item.pileGradeId) {
      serverMap.set(String(item.pileGradeId), item as Record<string, unknown>);
    }
  }

  for (const item of client) {
    if (isRecord(item) && item.pileGradeId) {
      clientMap.set(String(item.pileGradeId), item as Record<string, unknown>);
    }
  }

  const result = new Map<string, unknown>();

  for (const [id, item] of serverMap) {
    result.set(id, { ...item });
  }

  for (const [id, clientItem] of clientMap) {
    const serverItem = serverMap.get(id);
    if (serverItem) {
      const clientCount = Number(clientItem.count) || 0;
      const serverCount = Number(serverItem.count) || 0;
      result.set(id, {
        ...serverItem,
        pileGradeId: id,
        count: Math.max(clientCount, serverCount),
      });
    } else {
      result.set(id, clientItem);
    }
  }

  return Array.from(result.values());
}

/**
 * Merge drillings: union by typeId, additive meters.
 *
 * Drilling is cumulative — both sides likely reporting different parts of
 * the same drilling operation. Sum the meters.
 */
export function mergeDrillings(client: unknown[], server: unknown[]): unknown[] {
  const serverMap = new Map<string, Record<string, unknown>>();
  const clientMap = new Map<string, Record<string, unknown>>();

  for (const item of server) {
    if (isRecord(item) && item.typeId) {
      serverMap.set(String(item.typeId), item as Record<string, unknown>);
    }
  }

  for (const item of client) {
    if (isRecord(item) && item.typeId) {
      clientMap.set(String(item.typeId), item as Record<string, unknown>);
    }
  }

  const result = new Map<string, unknown>();

  for (const [id, item] of serverMap) {
    result.set(id, { ...item });
  }

  for (const [id, clientItem] of clientMap) {
    const serverItem = serverMap.get(id);
    if (serverItem) {
      const clientMeters = Number(clientItem.meters) || 0;
      const serverMeters = Number(serverItem.meters) || 0;
      const clientCount = Number(clientItem.count) || 0;
      const serverCount = Number(serverItem.count) || 0;
      result.set(id, {
        ...serverItem,
        typeId: id,
        meters: clientMeters + serverMeters,
        count: Math.max(clientCount, serverCount),
      });
    } else {
      result.set(id, clientItem);
    }
  }

  return Array.from(result.values());
}

/**
 * Merge downtimes: union by reasonId, additive duration.
 *
 * Downtime is cumulative — both sides reporting different downtime incidents.
 * Sum durations for same reason.
 */
export function mergeDowntimes(client: unknown[], server: unknown[]): unknown[] {
  const serverMap = new Map<string, Record<string, unknown>>();
  const clientMap = new Map<string, Record<string, unknown>>();

  for (const item of server) {
    if (isRecord(item) && item.reasonId) {
      const key = String(item.reasonId);
      const existing = serverMap.get(key);
      if (existing) {
        existing.duration = Number(existing.duration) + Number(item.duration);
      } else {
        serverMap.set(key, { ...item });
      }
    }
  }

  for (const item of client) {
    if (isRecord(item) && item.reasonId) {
      const key = String(item.reasonId);
      const existing = clientMap.get(key);
      if (existing) {
        existing.duration = Number(existing.duration) + Number(item.duration);
      } else {
        clientMap.set(key, { ...item });
      }
    }
  }

  const result = new Map<string, unknown>();

  for (const [id, item] of serverMap) {
    result.set(id, item);
  }

  for (const [id, clientItem] of clientMap) {
    const serverItem = serverMap.get(id);
    if (serverItem) {
      const clientDuration = Number(clientItem.duration) || 0;
      const serverDuration = Number(serverItem.duration) || 0;
      result.set(id, {
        ...serverItem,
        reasonId: id,
        duration: clientDuration + serverDuration,
      });
    } else {
      result.set(id, clientItem);
    }
  }

  return Array.from(result.values());
}

export function mergeCollections(
  client: Record<string, unknown>,
  server: Record<string, unknown>
): Map<string, unknown> {
  const result = new Map<string, unknown>();

  const collectionHandlers: Record<string, (c: unknown[], s: unknown[]) => unknown[]> = {
    piles: mergePiles,
    drillings: mergeDrillings,
    downtimes: mergeDowntimes,
  };

  for (const [key, handler] of Object.entries(collectionHandlers)) {
    const clientItems = client[key];
    const serverItems = server[key];

    if (Array.isArray(clientItems) && Array.isArray(serverItems)) {
      result.set(key, handler(clientItems, serverItems));
    } else if (Array.isArray(clientItems)) {
      result.set(key, clientItems);
    } else if (Array.isArray(serverItems)) {
      result.set(key, serverItems);
    }
  }

  return result;
}
