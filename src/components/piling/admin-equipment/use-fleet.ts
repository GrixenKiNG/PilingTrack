'use client';

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/api';
import { catchText } from '@/components/piling/admin-crews/crew-messages';
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
        if (res.status === 401) {
          setError('Сессия истекла — войдите снова.');
          return;
        }
        setError(`Сервер вернул ${res.status}`);
        return;
      }
      setSnapshot(await res.json());
      setError(null);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      // Обрыв сети fetch бросает TypeError с английским «Failed to fetch» (F-R112-1).
      setError(catchText(err, 'Не удалось загрузить парк техники'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs local state to the source prop/dependency when it changes
    setLoading(true);
    fetchSnapshot(abort.signal);
    return () => abort.abort();
  }, [fetchSnapshot]);

  return { snapshot, loading, error, refetch: () => fetchSnapshot() };
}
