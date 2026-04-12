'use client';

import { useState, useCallback, useEffect } from 'react';
import { authFetch } from '@/lib/api';
import { toast } from 'sonner';
import type { ReportDTO, SiteFlatDTO, PileGradeDTO, DrillingTypeDTO, DowntimeReasonDTO } from '@/lib/types';

interface OperatorUser {
  id: string;
  name: string;
}

interface PeriodSummary {
  totalPiles: number;
  totalDrilling: number;
  totalDowntime: number;
  reportCount: number;
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
  handleApplyPeriod: () => void;
  handleResetPeriod: () => void;
  loadReports: () => Promise<void>;
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

  const loadSites = useCallback(async () => {
    setLoadingSites(true);
    try {
      const res = await authFetch('/api/sites/all');
      if (res.ok) {
        const data = await res.json();
        setSites(data.sites || []);
      }
    } catch { /* ignore */ }
    finally { setLoadingSites(false); }
  }, []);

  const loadOperators = useCallback(async () => {
    try {
      const res = await authFetch('/api/users?role=OPERATOR');
      if (res.ok) {
        const data = await res.json();
        setOperators((data.users || []).map((u: { id: string; name: string }) => ({ id: u.id, name: u.name })));
      }
    } catch { /* ignore */ }
  }, []);

  const loadDictionary = useCallback(async () => {
    try {
      const res = await authFetch('/api/dictionary/all');
      if (res.ok) {
        const data = await res.json();
        setPileGrades(data.pileGrades || []);
        setDrillingTypes(data.drillingTypes || []);
        setDowntimeReasons(data.downtimeReasons || []);
      }
    } catch { /* ignore */ }
  }, []);

  const loadEquipment = useCallback(async () => {
    try {
      const res = await authFetch('/api/equipment');
      if (res.ok) {
        const data = await res.json();
        setEquipment((data.data || data.equipment || []).map((e: { id: string; name: string }) => ({ id: e.id, name: e.name })));
      }
    } catch { /* ignore */ }
  }, []);

  const loadReports = useCallback(async () => {
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
      const res = await authFetch(url);
      if (res.ok) {
        const data = await res.json();
        const reportsArray = Array.isArray(data.reports) ? data.reports : [];
        setReports(reportsArray);
        if (periodActive) {
          setPeriodSummary(data.summary || null);
        } else {
          setPeriodSummary(null);
        }
      }
    } catch {
      toast.error('Ошибка загрузки отчётов');
    } finally {
      setLoading(false);
    }
  }, [filterSiteId, periodActive, periodFrom, periodTo]);

  useEffect(() => {
    loadSites();
    loadOperators();
    loadDictionary();
    loadEquipment();
  }, [loadSites, loadOperators, loadDictionary, loadEquipment]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

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
    periodActive, periodSummary, loading, loadingSites,
    handleApplyPeriod, handleResetPeriod, loadReports,
  };
}
