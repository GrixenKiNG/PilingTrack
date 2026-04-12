/**
 * useSyncConflict — React Hook for Conflict Resolution UI
 *
 * Provides:
 * - List of unresolved conflicts from sync response
 * - Field-level diff between client and server data
 * - Manual resolution (accept client / accept server / custom merge)
 * - Re-sync after resolution
 *
 * Usage:
 *   const { conflicts, resolveConflict, resolveAll } = useSyncConflict();
 */

import { useState, useCallback } from 'react';
import type { Conflict, LocalChange } from '@/shared/types/sync';
import type { VectorClockData } from '@/shared/sync/vector-clock';

export interface ConflictFieldDiff {
  field: string;
  clientValue: unknown;
  serverValue: unknown;
  isCritical: boolean; // critical fields → server wins by default
}

export interface ResolvedConflict {
  entityId: string;
  resolvedData: Record<string, unknown>;
  vectorClock?: VectorClockData;
}

const CRITICAL_FIELDS = new Set([
  'status', 'date', 'siteId', 'userId', 'tenantId',
  'version', 'updatedAt', 'createdAt', 'deleted',
]);

export function useSyncConflict() {
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [resolved, setResolved] = useState<ResolvedConflict[]>([]);
  const [isResolving, setIsResolving] = useState(false);

  /**
   * Add conflicts from a sync response.
   */
  const addConflicts = useCallback((newConflicts: Conflict[]) => {
    setConflicts((prev) => [...prev, ...newConflicts]);
  }, []);

  /**
   * Get field-level diff for a conflict.
   */
  const getFieldDiff = useCallback((conflict: Conflict): ConflictFieldDiff[] => {
    const clientData = conflict.clientData as Record<string, unknown>;
    const serverData = conflict.serverData as Record<string, unknown>;

    const diffs: ConflictFieldDiff[] = [];
    const allKeys = new Set([
      ...Object.keys(clientData),
      ...Object.keys(serverData),
    ]);

    for (const key of allKeys) {
      const clientVal = clientData[key];
      const serverVal = serverData[key];

      if (JSON.stringify(clientVal) !== JSON.stringify(serverVal)) {
        diffs.push({
          field: key,
          clientValue: clientVal,
          serverValue: serverVal,
          isCritical: CRITICAL_FIELDS.has(key),
        });
      }
    }

    return diffs;
  }, []);

  /**
   * Resolve a single conflict manually.
   */
  const resolveConflict = useCallback(
    (
      conflict: Conflict,
      strategy: 'accept_client' | 'accept_server' | 'custom',
      customData?: Record<string, unknown>
    ): ResolvedConflict => {
      const clientData = conflict.clientData as Record<string, unknown>;
      const serverData = conflict.serverData as Record<string, unknown>;

      let resolvedData: Record<string, unknown>;

      if (strategy === 'accept_client') {
        resolvedData = clientData;
      } else if (strategy === 'accept_server') {
        resolvedData = serverData;
      } else {
        resolvedData = customData || serverData;
      }

      const resolved: ResolvedConflict = {
        entityId: (clientData.id || serverData.id) as string,
        resolvedData,
        vectorClock: conflict.vectorClock,
      };

      setResolved((prev) => [...prev, resolved]);
      setConflicts((prev) => prev.filter((c) => c !== conflict));

      return resolved;
    },
    []
  );

  /**
   * Auto-resolve all conflicts using a strategy.
   */
  const resolveAll = useCallback(
    (strategy: 'accept_client' | 'accept_server' | 'server_wins_critical'): ResolvedConflict[] => {
      const allResolved: ResolvedConflict[] = [];

      for (const conflict of conflicts) {
        const clientData = conflict.clientData as Record<string, unknown>;
        const serverData = conflict.serverData as Record<string, unknown>;

        let resolvedData: Record<string, unknown>;

        if (strategy === 'accept_client') {
          resolvedData = clientData;
        } else if (strategy === 'accept_server') {
          resolvedData = serverData;
        } else {
          // server_wins_critical: critical fields → server, rest → client
          resolvedData = { ...serverData };
          for (const [key, clientVal] of Object.entries(clientData)) {
            if (!CRITICAL_FIELDS.has(key)) {
              resolvedData[key] = clientVal;
            }
          }
        }

        allResolved.push({
          entityId: (clientData.id || serverData.id) as string,
          resolvedData,
          vectorClock: conflict.vectorClock,
        });
      }

      setResolved((prev) => [...prev, ...allResolved]);
      setConflicts([]);

      return allResolved;
    },
    [conflicts]
  );

  /**
   * Build sync changes from resolved conflicts for re-sync.
   */
  const buildResolvedChanges = useCallback(
    (resolvedConflicts: ResolvedConflict[]): LocalChange[] => {
      return resolvedConflicts.map((r, i) => ({
        entity: 'report' as const,
        op: 'upsert' as const,
        data: r.resolvedData,
        baseVersion: 0, // will be set by server
        opId: `resolve-${r.entityId}-${Date.now()}-${i}`,
        vectorClock: r.vectorClock,
      }));
    },
    []
  );

  /**
   * Clear all conflicts and resolved data.
   */
  const clear = useCallback(() => {
    setConflicts([]);
    setResolved([]);
  }, []);

  return {
    conflicts,
    resolved,
    isResolving,
    addConflicts,
    getFieldDiff,
    resolveConflict,
    resolveAll,
    buildResolvedChanges,
    clear,
    hasUnresolved: conflicts.length > 0,
    conflictCount: conflicts.length,
  };
}
