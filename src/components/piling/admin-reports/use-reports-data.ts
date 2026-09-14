'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { authFetch, isAbort, loadJson } from '@/lib/api';
import { toast } from 'sonner';
import type { ReportDTO, SiteFlatDTO, PileGradeDTO, DrillingTypeDTO, DowntimeReasonDTO } from '@/lib/types';

interface OperatorUser {
  id: string;
  name: string;
}

type NamedOption = { id: string; name: string };

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
  loading: boolean;
  /** Set when the reports request fails (HTTP error or network). Lets the UI
   *  show a real error state instead of a silently-empty list — see the
   *  2026-05-30 incident where a failing query rendered as "no reports". */
  error: string | null;
  /** Списки для отбора прочитаны не полностью — фильтр показывает не всё. */
  filterError: string | null;
  loadingReferenceData: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  /** Сколько отчётов под отбором всего — не сколько подгружено. */
  totalReports: number;
  handleApplyPeriod: () => void;
  handleResetPeriod: () => void;
  loadMoreReports: () => Promise<void>;
  loadReports: () => Promise<void>;
  loadReferenceData: () => Promise<void>;
}

const REPORTS_PAGE_LIMIT = 100;

export function useReportsData(): UseReportsDataReturn {
  const [reports, setReports] = useState<ReportDTO[]>([]);
  const [sites, setSites] = useState<SiteFlatDTO[]>([]);
  const [filterError, setFilterError] = useState<string | null>(null);

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

  const [loading, setLoading] = useState(true);
  const [loadingReferenceData, setLoadingReferenceData] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [totalReports, setTotalReports] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
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
      try {
        const [sitesRes, operatorsRes, equipmentRes] = await Promise.allSettled([
          loadJson<{ sites?: SiteFlatDTO[] }>('/api/sites/all', { signal: abortController.signal }),
          loadJson<{ users?: NamedOption[] }>('/api/users?role=OPERATOR', { signal: abortController.signal }),
          loadJson<{ data?: NamedOption[]; equipment?: NamedOption[] }>('/api/equipment', { signal: abortController.signal }),
        ]);
        if (!isMounted) return;

        // Отбор строится из этих трёх списков, а отказ здесь молча проглатывался.
        // Пустой фильтр объекта читался как «объектов нет», и отчёты искали не по тому.
        const missing: string[] = [];
        if (sitesRes.status === 'fulfilled') setSites(sitesRes.value.sites || []);
        else if (!isAbort(sitesRes.reason)) missing.push('объекты');

        if (operatorsRes.status === 'fulfilled') {
          setOperators((operatorsRes.value.users || []).map((u) => ({ id: u.id, name: u.name })));
        } else if (!isAbort(operatorsRes.reason)) missing.push('операторы');

        if (equipmentRes.status === 'fulfilled') {
          const list = equipmentRes.value.data || equipmentRes.value.equipment || [];
          setEquipment(list.map((e) => ({ id: e.id, name: e.name })));
        } else if (!isAbort(equipmentRes.reason)) missing.push('установки');

        setFilterError(missing.length ? `Не загружено: ${missing.join(', ')}. Отбор неполный.` : null);
      } catch {
        if (isMounted) setFilterError('Не удалось загрузить списки для отбора.');
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

    // Operators/equipment are now loaded eagerly on mount alongside sites —
    // no need to re-fetch them here. We only need dictionaries for the dialog.
    const promise = Promise.all([
      authFetch('/api/dictionary/all'),
    ])
      .then(async ([dictionaryRes]) => {
        if (dictionaryRes.ok) {
          const data = await dictionaryRes.json();
          setPileGrades(data.pileGrades || []);
          setDrillingTypes(data.drillingTypes || []);
          setDowntimeReasons(data.downtimeReasons || []);
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
          params.set('limit', String(REPORTS_PAGE_LIMIT));
          const qs = params.toString();
          url = qs ? `/api/reports/all?${qs}` : '/api/reports/all';
        }
        const res = await authFetch(url, { signal: abortController.signal });
        if (!isMounted) return;
        if (res.ok) {
          const data = await res.json();
          const reportsArray = Array.isArray(data.reports) ? data.reports : [];
          setReports(reportsArray);
          // В режиме периода сервер отдаёт срез целиком — всё загруженное и
          // есть весь отбор.
          setTotalReports(
            typeof data.total === 'number' ? data.total : reportsArray.length,
          );
          setHasMore(!periodActive && Boolean(data.hasMore));
          setNextCursor(!periodActive ? data.nextCursor ?? null : null);
        } else {
          // HTTP error (e.g. 500): fetch resolves with res.ok=false and does
          // NOT throw, so without this branch the list would render empty as
          // if there were simply no reports. Surface it as a real error.
          setError('Не удалось загрузить отчёты. Сервер вернул ошибку.');
          setHasMore(false);
          setNextCursor(null);
          toast.error('Ошибка загрузки отчётов');
        }
      } catch (error) {
        if (isMounted && !(error instanceof Error && error.name === 'AbortError')) {
          setError('Не удалось загрузить отчёты. Проверьте соединение.');
          setHasMore(false);
          setNextCursor(null);
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

  const loadMoreReports = useCallback(async () => {
    if (periodActive || loadingMore || !hasMore || !nextCursor) return;
    setLoadingMore(true);
    setError(null);
    try {
      const params = new URLSearchParams({ cursor: nextCursor, limit: String(REPORTS_PAGE_LIMIT) });
      if (filterSiteId !== 'all') params.set('siteId', filterSiteId);
      if (filterUserId !== 'all') params.set('userId', filterUserId);
      const res = await authFetch(`/api/reports/all?${params.toString()}`);
      if (!res.ok) {
        setError('Не удалось догрузить отчёты. Сервер вернул ошибку.');
        toast.error('Ошибка догрузки отчётов');
        return;
      }
      const data = await res.json();
      const reportsArray = Array.isArray(data.reports) ? data.reports : [];
      setReports((prev) => [...prev, ...reportsArray]);
      setHasMore(Boolean(data.hasMore));
      setNextCursor(data.nextCursor ?? null);
    } catch {
      setError('Не удалось догрузить отчёты. Проверьте соединение.');
      toast.error('Ошибка догрузки отчётов');
    } finally {
      setLoadingMore(false);
    }
  }, [filterSiteId, filterUserId, hasMore, loadingMore, nextCursor, periodActive]);

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
  };

  return {
    reports, sites, operators, pileGrades, drillingTypes, downtimeReasons, equipment,
    filterSiteId, setFilterSiteId,
    filterUserId, setFilterUserId,
    periodFrom, setPeriodFrom, periodTo, setPeriodTo,
    periodActive, loading, loadingReferenceData, loadingMore, hasMore, totalReports, error, filterError,
    handleApplyPeriod, handleResetPeriod, loadMoreReports, loadReports, loadReferenceData,
  };
}
