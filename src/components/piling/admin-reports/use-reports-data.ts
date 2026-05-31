'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { authFetch } from '@/lib/api';
import { toast } from 'sonner';
import type { ReportDTO, SiteFlatDTO, PileGradeDTO, DrillingTypeDTO, DowntimeReasonDTO } from '@/lib/types';

interface OperatorUser {
  id: string;
  name: string;
}

interface PeriodSummary {
  totalPiles: number;
  totalPileMeters?: number;
  totalDrillingCount?: number;
  totalDrilling: number;
  totalDowntime: number;
  reportCount: number;
  uniqueSites?: number;
  uniqueOperators?: number;
}

export interface UseReportsDataReturn {
  reports: ReportDTO[];
  sites: SiteFlatDTO[];
  operators: OperatorUser[];
  pileGrades: PileGradeDTO[];
  drillingTypes: DrillingTypeDTO[];
  downtimeReasons: DowntimeReasonDTO[];
  equipment: { id: string; name: string }[];
  filterSiteId: string;
  setFilterSiteId: (v: string) => void;
  filterUserId: string;
  setFilterUserId: (v: string) => void;
  periodFrom: string;
  setPeriodFrom: (v: string) => void;
  periodTo: string;
  setPeriodTo: (v: string) => void;
  periodActive: boolean;
  periodSummary: PeriodSummary | null;
  loading: boolean;
  /** Set when the reports request fails (HTTP error or network). Lets the UI
   *  show a real error state instead of a silently-empty list — see the
   *  2026-05-30 incident where a failing query rendered as "no reports". */
  error: string | null;
  loadingSites: boolean;
  loadingReferenceData: boolean;
  handleApplyPeriod: () => void;
  handleResetPeriod: () => void;
  loadReports: () => Promise<void>;
  loadReferenceData: () => Promise<void>;
}

export function useReportsData(): UseReportsDataReturn {
  const [reports, setReports] = useState<ReportDTO[]>([]);
  const [sites, setSites] = useState<SiteFlatDTO[]>([]);
  const [operators, setOperators] = useState<OperatorUser[]>([]);
  const [pileGrades, setPileGrades] = useState<PileGradeDTO[]>([]);
  const [drillingTypes, setDrillingTypes] = useState<DrillingTypeDTO[]>([]);
  const [downtimeReasons, setDowntimeReasons] = useState<DowntimeReasonDTO[]>([]);
  const [equipment, setEquipment] = useState<{ id: string; name: string }[]>([]);

  const [filterSiteId, setFilterSiteId] = useState<string>('all');
  const [filterUserId, setFilterUserId] = useState<string>('all');
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  const [periodActive, setPeriodActive] = useState(false);
  const [periodSummary, setPeriodSummary] = useState<PeriodSummary | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadingSites, setLoadingSites] = useState(false);
  const [loadingReferenceData, setLoadingReferenceData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const referenceDataLoadedRef = useRef(false);
  const referenceDataPromiseRef = useRef<Promise<void> | null>(null);
  // Bumped to force a reports refetch (retry after error, refresh after
  // create/delete). The load itself lives in the effect below.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const abortController = new AbortController();
    let isMounted = true;

    const loadSitesAndOperators = async () => {
      setLoadingSites(true);
      try {
        const [sitesRes, operatorsRes] = await Promise.all([
          authFetch('/api/sites/all', { signal: abortController.signal }),
          authFetch('/api/users?role=OPERATOR', { signal: abortController.signal }),
        ]);
        if (!isMounted) return;
        if (sitesRes.ok) {
          const data = await sitesRes.json();
          setSites(data.sites || []);
        }
        if (operatorsRes.ok) {
          const data = await operatorsRes.json();
          setOperators((data.users || []).map((u: { id: string; name: string }) => ({ id: u.id, name: u.name })));
        }
      } catch (error) {
        if (isMounted && !(error instanceof Error && error.name === 'AbortError')) {
          /* ignore */
        }
      } finally {
        if (isMounted) setLoadingSites(false);
      }
    };

    void loadSitesAndOperators();

    return () => {
      isMounted = false;
      abortController.abort();
    };
  }, []);

  const loadReferenceData = useCallback(async () => {
    if (referenceDataLoadedRef.current) {
      return;
    }

    if (referenceDataPromiseRef.current) {
      return referenceDataPromiseRef.current;
    }

    setLoadingReferenceData(true);

    // Operators are now loaded eagerly on mount alongside sites — no need to
    // re-fetch them here. We only need dictionary + equipment for the dialog.
    const promise = Promise.all([
      authFetch('/api/dictionary/all'),
      authFetch('/api/equipment'),
    ])
      .then(async ([dictionaryRes, equipmentRes]) => {
        if (dictionaryRes.ok) {
          const data = await dictionaryRes.json();
          setPileGrades(data.pileGrades || []);
          setDrillingTypes(data.drillingTypes || []);
          setDowntimeReasons(data.downtimeReasons || []);
        }

        if (equipmentRes.ok) {
          const data = await equipmentRes.json();
          setEquipment((data.data || data.equipment || []).map((e: { id: string; name: string }) => ({ id: e.id, name: e.name })));
        }

        referenceDataLoadedRef.current = true;
      })
      .catch(() => {
        toast.error('Ошибка загрузки справочников для формы отчёта');
      })
      .finally(() => {
        setLoadingReferenceData(false);
        referenceDataPromiseRef.current = null;
      });

    referenceDataPromiseRef.current = promise;
    return promise;
  }, []);

  useEffect(() => {
    const abortController = new AbortController();
    let isMounted = true;

    const loadReports = async () => {
      setLoading(true);
      setError(null);
      try {
        let url: string;
        if (periodActive && periodFrom && periodTo) {
          const params = new URLSearchParams({ dateFrom: periodFrom, dateTo: periodTo });
          if (filterSiteId !== 'all') params.set('siteId', filterSiteId);
          if (filterUserId !== 'all') params.set('userId', filterUserId);
          url = `/api/reports/period?${params}`;
        } else {
          const params = new URLSearchParams();
          if (filterSiteId !== 'all') params.set('siteId', filterSiteId);
          if (filterUserId !== 'all') params.set('userId', filterUserId);
          const qs = params.toString();
          url = qs ? `/api/reports/all?${qs}` : '/api/reports/all';
        }
        const res = await authFetch(url, { signal: abortController.signal });
        if (!isMounted) return;
        if (res.ok) {
          const data = await res.json();
          const reportsArray = Array.isArray(data.reports) ? data.reports : [];
          setReports(reportsArray);
          if (periodActive) {
            setPeriodSummary(data.summary || null);
          } else {
            setPeriodSummary(null);
          }
        } else {
          // HTTP error (e.g. 500): fetch resolves with res.ok=false and does
          // NOT throw, so without this branch the list would render empty as
          // if there were simply no reports. Surface it as a real error.
          setError('Не удалось загрузить отчёты. Сервер вернул ошибку.');
          toast.error('Ошибка загрузки отчётов');
        }
      } catch (error) {
        if (isMounted && !(error instanceof Error && error.name === 'AbortError')) {
          setError('Не удалось загрузить отчёты. Проверьте соединение.');
          toast.error('Ошибка загрузки отчётов');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadReports();

    return () => {
      isMounted = false;
      abortController.abort();
    };
  }, [filterSiteId, filterUserId, periodActive, periodFrom, periodTo, reloadKey]);

  // Trigger a refetch: used by the error-state "retry" button and to refresh
  // the list after a report is created or deleted.
  const loadReports = useCallback(async () => {
    setReloadKey((k) => k + 1);
  }, []);

  const handleApplyPeriod = () => {
    if (!periodFrom || !periodTo) {
      toast.error('Укажите даты начала и конца периода');
      return;
    }
    if (periodFrom > periodTo) {
      toast.error('Дата начала не может быть позже даты конца');
      return;
    }
    setPeriodActive(true);
  };

  const handleResetPeriod = () => {
    setPeriodFrom('');
    setPeriodTo('');
    setPeriodActive(false);
    setPeriodSummary(null);
  };

  return {
    reports, sites, operators, pileGrades, drillingTypes, downtimeReasons, equipment,
    filterSiteId, setFilterSiteId,
    filterUserId, setFilterUserId,
    periodFrom, setPeriodFrom, periodTo, setPeriodTo,
    periodActive, periodSummary, loading, loadingSites, loadingReferenceData, error,
    handleApplyPeriod, handleResetPeriod, loadReports, loadReferenceData,
  };
}
