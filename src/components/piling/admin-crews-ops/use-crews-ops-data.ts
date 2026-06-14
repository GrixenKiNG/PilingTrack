'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/api';

/** Subset of listCrewSummaries() via GET /api/crews/all. */
export interface CrewOpsRow {
  id: string;
  name: string;
  operatorName: string;
  assistantsCount: number;
  equipmentName: string;
  siteId: string;
  siteName: string;
  isActive: boolean;
}

export interface CrewsOpsData {
  rows: CrewOpsRow[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useCrewsOpsData(): CrewsOpsData {
  const [rows, setRows] = useState<CrewOpsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await authFetch('/api/crews/all');
        if (!res.ok) throw new Error(`Бригады недоступны (${res.status})`);
        const data: CrewOpsRow[] = (await res.json()).data ?? [];
        if (!cancelled) setRows(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Не удалось загрузить бригады');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { rows, loading, error, reload: () => setTick((t) => t + 1) };
}
