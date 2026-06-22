'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/api';
import type { ReportHistory } from '@/services/reports/report-history';

interface UseReportHistoryState {
  data: ReportHistory | null;
  loading: boolean;
  error: boolean;
}

export function useReportHistory(reportId: string | null | undefined): UseReportHistoryState {
  const [state, setState] = useState<UseReportHistoryState>({ data: null, loading: false, error: false });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs local state to the source prop/dependency when it changes
    if (!reportId) { setState({ data: null, loading: false, error: false }); return; }
    const controller = new AbortController();
    setState({ data: null, loading: true, error: false });
    void (async () => {
      try {
        const res = await authFetch(`/api/reports/${encodeURIComponent(reportId)}/history`, { signal: controller.signal });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as ReportHistory;
        setState({ data, loading: false, error: false });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setState({ data: null, loading: false, error: true });
      }
    })();
    return () => controller.abort();
  }, [reportId]);

  return state;
}
