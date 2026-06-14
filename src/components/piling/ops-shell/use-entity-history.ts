'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/api';
import type { OpsHistoryEntry } from './ops-detail-panel';

export interface EntityHistoryState {
  entries: OpsHistoryEntry[] | null;
  loading: boolean;
  error: boolean;
}

/**
 * Fetches the change history for one entity from GET /api/audit. Shaped for
 * OpsHistoryList. Pass `scope` (e.g. 'crews', 'sites') and the entity id; the
 * hook refetches when either changes. A null/empty id means "nothing selected".
 */
export function useEntityHistory(scope: string, targetId: string | null | undefined): EntityHistoryState {
  const [state, setState] = useState<EntityHistoryState>({ entries: null, loading: false, error: false });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!targetId) {
        if (!cancelled) setState({ entries: null, loading: false, error: false });
        return;
      }
      setState({ entries: null, loading: true, error: false });
      try {
        const res = await authFetch(`/api/audit?scope=${encodeURIComponent(scope)}&targetId=${encodeURIComponent(targetId)}`);
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json();
        if (!cancelled) setState({ entries: json.entries ?? [], loading: false, error: false });
      } catch {
        if (!cancelled) setState({ entries: null, loading: false, error: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [scope, targetId]);

  return state;
}
