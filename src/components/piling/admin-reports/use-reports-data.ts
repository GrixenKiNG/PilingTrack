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
  periodFrom: string;
  setPeriodFrom: (v: string) => void;
  periodTo: string;
  setPeriodTo: (v: string) => void;
  periodActive: boolean;
  periodSummary: PeriodSummary | null;
  loading: boolean;
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
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  const [periodActive, setPeriodActive] = useState(false);
  const [periodSummary, setPeriodSummary] = useState<PeriodSummary | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadingSites, setLoadingSites] = useState(false);
  const [loadingReferenceData, setLoadingReferenceData] = useState(false);

  const referenceDataLoadedRef = useRef(false);
  const referenceDataPromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    let isMounted = true;

    const loadSites = async () => {
      setLoadingSites(true);
      try {
        const res = await authFetch('/api/sites/all', { signal: abortController.signal });
        if (isMounted && res.ok) {
          const data = await res.json();
          setSites(data.sites || []);
        }
      } catch (error) {
        if (isMounted && !(error instanceof Error && error.name === 'AbortError')) {
          /* ignore */
        }
      } finally {
        if (isMounted) setLoadingSites(false);
      }
    };

    void loadSites();

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

    const promise = Promise.all([
      authFetch('/api/users?role=OPERATOR'),
      authFetch('/api/dictionary/all'),
      authFetch('/api/equipment'),
    ])
      .then(async ([operatorsRes, dictionaryRes, equipmentRes]) => {
        if (operatorsRes.ok) {
          const data = await operatorsRes.json();
          setOperators((data.users || []).map((u: { id: string; name: string }) => ({ id: u.id, name: u.name })));
        }

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
      try {
        let url: string;
        if (periodActive && periodFrom && periodTo) {
          const params = new URLSearchParams({ dateFrom: periodFrom, dateTo: periodTo });
          if (filterSiteId !== 'all') params.set('siteId', filterSiteId);
          url = `/api/reports/period?${params}`;
        } else {
          url = filterSiteId === 'all'
            ? '/api/reports/all'
            : `/api/reports/all?siteId=${filterSiteId}`;
        }
        const res = await authFetch(url, { signal: abortController.signal });
        if (isMounted && res.ok) {
          const data = await res.json();
          const reportsArray = Array.isArray(data.reports) ? data.reports : [];
          setReports(reportsArray);
          if (periodActive) {
            setPeriodSummary(data.summary || null);
          } else {
            setPeriodSummary(null);
          }
        }
      } catch (error) {
        if (isMounted && !(error instanceof Error && error.name === 'AbortError')) {
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
  }, [filterSiteId, periodActive, periodFrom, periodTo]);

  const loadReports = useCallback(async () => {
    // This is a stub function to maintain the interface
    // The actual loading is done through the useEffect above
    // This can be called explicitly if needed from the component
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
    filterSiteId, setFilterSiteId, periodFrom, setPeriodFrom, periodTo, setPeriodTo,
    periodActive, periodSummary, loading, loadingSites, loadingReferenceData,
    handleApplyPeriod, handleResetPeriod, loadReports, loadReferenceData,
  };
}
