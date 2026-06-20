'use client';

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/api';
import type { FleetSnapshot } from './fleet-types';

/**
 * Loads the fleet snapshot from the single source shared with /monitoring and
 * the dashboard. The Установки command center renders KPIs + cards from this;
 * CRUD still goes through /api/equipment (see use-equipment-list).
 */
export function useFleet() {
  const [snapshot, setSnapshot] = useState<FleetSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSnapshot = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await authFetch('/api/monitoring/fleet', { signal });
      if (!res.ok) {
        setError(`Сервер вернул ${res.status}`);
        return;
      }
      setSnapshot(await res.json());
      setError(null);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    fetchSnapshot(abort.signal);
    return () => abort.abort();
  }, [fetchSnapshot]);

  return { snapshot, loading, error, refetch: () => fetchSnapshot() };
}
