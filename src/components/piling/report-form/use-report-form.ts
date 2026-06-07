'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { usePilingStore } from '@/lib/store';
import { authFetch } from '@/lib/api';
import { pushClientFeedback } from '@/lib/client-feedback';
import { hapticClick, hapticSuccess, hapticError } from '@/lib/haptic-feedback';
import { getTodayInTimezone } from '@/lib/timezone';
import type { SiteWithTreeDTO, PileGradeDTO, DrillingTypeDTO, DowntimeReasonDTO, CreateReportPayload } from '@/lib/types';

export interface PileEntry { id: string; picketId: string; pileGradeId: string; count: number; }
export interface DrillingEntry { id: string; picketId: string; typeId: string; count: number; metersPerUnit: number; meters: number; }
export interface DowntimeEntry { id: string; reasonId: string; duration: number; comment: string; }

export interface UseReportFormReturn {
  reportId: string;
  date: string; setDate: (v: string) => void;
  shiftStart: string; setShiftStart: (v: string) => void;
  shiftEnd: string; setShiftEnd: (v: string) => void;
  sites: { id: string; name: string }[];
  siteTree: SiteWithTreeDTO | null;
  setSiteTree: (v: SiteWithTreeDTO | null) => void;
  selectedSiteId: string;
  setSelectedSiteId: (v: string) => void;
  pileGrades: PileGradeDTO[];
  drillingTypes: DrillingTypeDTO[];
  downtimeReasons: DowntimeReasonDTO[];
  equipment: { id: string; name: string }[];
  selectedEquipmentId: string; setSelectedEquipmentId: (v: string) => void;
  selectedFieldId: string; setSelectedFieldId: (v: string) => void;
  selectedClusterId: string; setSelectedClusterId: (v: string) => void;
  selectedPicketId: string; setSelectedPicketId: (v: string) => void;
  piles: PileEntry[]; setPiles: React.Dispatch<React.SetStateAction<PileEntry[]>>;
  drillings: DrillingEntry[]; setDrillings: React.Dispatch<React.SetStateAction<DrillingEntry[]>>;
  downtimes: DowntimeEntry[]; setDowntimes: React.Dispatch<React.SetStateAction<DowntimeEntry[]>>;
  showDowntime: boolean; setShowDowntime: (v: boolean) => void;
  quickMode: boolean; setQuickMode: (v: boolean) => void;
  loading: boolean;
  loadError: boolean;
  reloadData: () => void;
  submitting: boolean;
  loadingReport: boolean;
  submittedAt: string | null;
  addPile: (gradeId: string, count: number) => void;
  addDrilling: (typeId: string, count: number, metersPerUnit: number) => void;
  addDowntime: (reasonId: string, duration: number, comment: string) => void;
  removePile: (id: string) => void;
  removeDrilling: (id: string) => void;
  removeDowntime: (id: string) => void;
  handleSubmit: () => Promise<void>;
  getPileMetersPerUnit: (gradeId: string) => number;
  getPicketPath: (picketId: string) => string;
  getPileGradeName: (id: string) => string;
  getDrillTypeName: (id: string) => string;
  getDowntimeReasonName: (id: string) => string;
  loadSiteTree: (siteId: string) => void;
}

export function useReportForm(): UseReportFormReturn {
  const user = usePilingStore((s) => s.currentUser);
  const selectedSiteId = usePilingStore((s) => s.selectedSiteId);
  const setSelectedSite = usePilingStore((s) => s.setSelectedSite);

  // Pre-generate so the photo widget can attach a file before the report
  // is submitted; loadReport replaces this with the persisted id when editing.
  const [reportId, setReportId] = useState(() => crypto.randomUUID());
  const [date, setDate] = useState('');
  const [shiftStart, setShiftStart] = useState('08:00');
  const [shiftEnd, setShiftEnd] = useState('20:00');
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
  const [siteTree, setSiteTree] = useState<SiteWithTreeDTO | null>(null);
  const [pileGrades, setPileGrades] = useState<PileGradeDTO[]>([]);
  const [drillingTypes, setDrillingTypes] = useState<DrillingTypeDTO[]>([]);
  const [downtimeReasons, setDowntimeReasons] = useState<DowntimeReasonDTO[]>([]);
  const [equipment, setEquipment] = useState<{ id: string; name: string }[]>([]);
  const [selectedEquipmentId, setSelectedEquipmentId] = useState('');

  const [selectedFieldId, setSelectedFieldId] = useState('');
  const [selectedClusterId, setSelectedClusterId] = useState('');
  const [selectedPicketId, setSelectedPicketId] = useState('');

  const [piles, setPiles] = useState<PileEntry[]>([]);
  const [drillings, setDrillings] = useState<DrillingEntry[]>([]);
  const [downtimes, setDowntimes] = useState<DowntimeEntry[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [showDowntime, setShowDowntime] = useState(false);
  const [quickMode, setQuickMode] = useState(true);

  function parsePileLengthFromGradeName(name: string): number | null {
    const normalized = name.replace(',', '.');
    const match = normalized.match(/(\d{1,2})(?:\.\d+)?(?:\s*x\s*\d+(?:\.\d+)?)?$/i)
      || normalized.match(/(\d{1,2})\.\d+/);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  }

  const getPileMetersPerUnit = useCallback((pileGradeId: string) => {
    const gradeName = pileGrades.find((g) => g.id === pileGradeId)?.name || '';
    const parsedLength = parsePileLengthFromGradeName(gradeName);
    if (parsedLength !== null) return parsedLength;
    return siteTree?.pilePlans?.find((plan) => plan.pileGradeId === pileGradeId)?.metersPerUnit || 0;
  }, [pileGrades, siteTree]);

  // Load data
  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(false);
    try {
      const [sitesRes, dictRes] = await Promise.all([
        authFetch(`/api/sites?userId=${user.id}`),
        authFetch('/api/dictionary/all'),
      ]);
      if (!sitesRes.ok || !dictRes.ok) {
        throw new Error(`load failed: sites=${sitesRes.status} dict=${dictRes.status}`);
      }
      const sitesData = await sitesRes.json();
      setSites(sitesData.data || sitesData.sites || []);
      const dictData = await dictRes.json();
      setPileGrades(dictData.pileGrades || []);
      setDrillingTypes(dictData.drillingTypes || []);
      setDowntimeReasons(dictData.downtimeReasons || []);
      // Load equipment. Операторам показываем закреплённую за ними технику
      // независимо от выбранного объекта — так же, как Мониторинг (fleet).
      // Раньше передавали siteId, и установка пропадала из отчёта, если объект
      // не совпадал с объектом бригады оператора.
      try {
        const eqRes = await authFetch('/api/equipment');
        if (eqRes.ok) {
          const data = await eqRes.json();
          setEquipment((data.data || data.equipment || []).map((e: { id: string; name: string }) => ({ id: e.id, name: e.name })));
        }
      } catch { /* ignore */ }
      // Load existing report
      if (selectedSiteId) {
        setLoadingReport(true);
        try {
          const reportRes = await authFetch(`/api/reports/edit?userId=${user.id}&siteId=${selectedSiteId}&date=${date}`);
          if (reportRes.ok) {
            const data = await reportRes.json();
            if (data.report) {
              const r = data.report;
              setReportId(r.reportId || '');
              if (r.shiftStart) setShiftStart(r.shiftStart);
              if (r.shiftEnd) setShiftEnd(r.shiftEnd);
              if (r.equipmentId) setSelectedEquipmentId(r.equipmentId);
              if (r.piles?.length > 0) {
                setPiles(r.piles.map((p: any) => ({ id: p.id, picketId: p.picketId || '', pileGradeId: p.pileGradeId, count: p.count })));
              }
              if (r.drillings?.length > 0) {
                setDrillings(r.drillings.map((d: any) => ({ id: d.id, picketId: d.picketId || '', typeId: d.typeId, count: d.count || 1, metersPerUnit: d.metersPerUnit || 0, meters: d.meters })));
              }
              if (r.downtimes?.length > 0) {
                setDowntimes(r.downtimes.map((dt: any) => ({ id: dt.id, reasonId: dt.reasonId, duration: dt.duration, comment: dt.comment || '' })));
                setShowDowntime(true);
              }
            }
          }
        } finally { setLoadingReport(false); }
      }
    } catch {
      setLoadError(true);
      toast.error('Не удалось загрузить данные формы');
    } finally { setLoading(false); }
  }, [user, selectedSiteId, date]);

  // Init date
  useEffect(() => { if (!date) setDate(getTodayInTimezone()); }, [date]);

  // Load site tree
  const loadSiteTree = useCallback((siteId: string | null) => {
    setSelectedEquipmentId('');
    if (!siteId) return;
    authFetch(`/api/sites/${siteId}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (data?.site) setSiteTree(data.site); })
      .catch(() => toast.error('Не удалось загрузить план объекта'));
  }, []);

  useEffect(() => { loadSiteTree(selectedSiteId); }, [selectedSiteId, loadSiteTree]);
  useEffect(() => { if (!date) return; loadData(); }, [date, loadData]);

  // Draft management — snapshot via ref so the interval isn't torn
  // down/recreated on every keystroke.
  const draftSnapshotRef = useRef({ piles, drillings, downtimes, shiftStart, shiftEnd, selectedEquipmentId, selectedFieldId, selectedClusterId, selectedPicketId });
  draftSnapshotRef.current = { piles, drillings, downtimes, shiftStart, shiftEnd, selectedEquipmentId, selectedFieldId, selectedClusterId, selectedPicketId };

  useEffect(() => {
    if (!user || !selectedSiteId || !date) return;
    const draftKey = `report-draft-${user.id}-${selectedSiteId}-${date}`;
    const saveDraft = () => {
      const s = draftSnapshotRef.current;
      if (s.piles.length > 0 || s.drillings.length > 0 || s.downtimes.length > 0) {
        localStorage.setItem(draftKey, JSON.stringify({ ...s, savedAt: new Date().toISOString() }));
      }
    };
    const interval = setInterval(saveDraft, 30_000);
    window.addEventListener('beforeunload', saveDraft);
    return () => { clearInterval(interval); window.removeEventListener('beforeunload', saveDraft); saveDraft(); };
  }, [user, selectedSiteId, date]);

  // Restore draft
  useEffect(() => {
    if (!user || !selectedSiteId || !date) return;
    const draftKey = `report-draft-${user.id}-${selectedSiteId}-${date}`;
    const draftStr = localStorage.getItem(draftKey);
    if (!draftStr) return;
    try {
      const draft = JSON.parse(draftStr);
      const savedAt = new Date(draft.savedAt);
      if ((Date.now() - savedAt.getTime()) / (1000 * 60 * 60) > 24) { localStorage.removeItem(draftKey); return; }
      if (piles.length === 0 && drillings.length === 0 && downtimes.length === 0) {
        if (draft.piles?.length) setPiles(draft.piles);
        if (draft.drillings?.length) setDrillings(draft.drillings);
        if (draft.downtimes?.length) { setDowntimes(draft.downtimes); setShowDowntime(true); }
        if (draft.shiftStart) setShiftStart(draft.shiftStart);
        if (draft.shiftEnd) setShiftEnd(draft.shiftEnd);
        if (draft.selectedEquipmentId) setSelectedEquipmentId(draft.selectedEquipmentId);
        if (draft.selectedFieldId) setSelectedFieldId(draft.selectedFieldId);
        if (draft.selectedClusterId) setSelectedClusterId(draft.selectedClusterId);
        if (draft.selectedPicketId) setSelectedPicketId(draft.selectedPicketId);
        toast.info('Восстановлен черновик', { description: `Сохранён ${savedAt.toLocaleString('ru-RU')}` });
      }
    } catch { localStorage.removeItem(draftKey); }
  }, [user, selectedSiteId, date]);

  // Helpers
  const getPicketPath = (picketId: string): string => {
    if (!picketId || !siteTree) return '';
    for (const field of siteTree.fields) {
      for (const cluster of field.clusters) {
        const picket = cluster.pickets.find((p) => p.id === picketId);
        if (picket) return `${field.name} → ${cluster.name} → ${picket.name}`;
      }
    }
    return '';
  };

  const getPileGradeName = (id: string) => pileGrades.find((g) => g.id === id)?.name || id;
  const getDrillTypeName = (id: string) => drillingTypes.find((t) => t.id === id)?.name || id;
  const getDowntimeReasonName = (id: string) => downtimeReasons.find((r) => r.id === id)?.name || id;

  const addPile = (gradeId: string, count: number) => {
    if (!gradeId || count <= 0) { toast.error('Заполните марку и количество'); return; }
    setPiles((prev) => [...prev, { id: crypto.randomUUID(), picketId: selectedPicketId, pileGradeId: gradeId, count }]);
    setSelectedPicketId(''); hapticClick(); toast.success('Свая добавлена');
  };

  const addDrilling = (typeId: string, count: number, metersPerUnit: number) => {
    if (!typeId || count <= 0 || metersPerUnit <= 0) { toast.error('Заполните тип бурения, количество и метры'); return; }
    setDrillings((prev) => [...prev, { id: crypto.randomUUID(), picketId: selectedPicketId, typeId, count, metersPerUnit, meters: Number((count * metersPerUnit).toFixed(1)) }]);
    setSelectedPicketId(''); toast.success('Бурение добавлено');
  };

  const addDowntime = (reasonId: string, duration: number, comment: string) => {
    if (!reasonId || duration <= 0) { toast.error('Заполните причину и длительность'); return; }
    setDowntimes((prev) => [...prev, { id: crypto.randomUUID(), reasonId, duration, comment }]);
    toast.success('Простой добавлен');
  };

  const removePile = (id: string) => setPiles((prev) => prev.filter((p) => p.id !== id));
  const removeDrilling = (id: string) => setDrillings((prev) => prev.filter((d) => d.id !== id));
  const removeDowntime = (id: string) => setDowntimes((prev) => prev.filter((d) => d.id !== id));

  const handleSubmit = async () => {
    if (!selectedSiteId || !user) { toast.error('Выберите объект'); return; }
    if (piles.length === 0 && drillings.length === 0 && downtimes.length === 0) { toast.error('Добавьте хотя бы одну сваю, бурение или простой'); return; }
    const finalReportId = reportId || crypto.randomUUID();
    setSubmitting(true);
    try {
      const payload: CreateReportPayload = {
        reportId: finalReportId, userId: user.id, siteId: selectedSiteId, date, shiftStart, shiftEnd,
        equipmentId: selectedEquipmentId || undefined,
        piles: piles.map((p) => ({ picketId: p.picketId || undefined, pileGradeId: p.pileGradeId, count: p.count })),
        drillings: drillings.map((d) => ({ picketId: d.picketId || undefined, typeId: d.typeId, count: d.count, metersPerUnit: d.metersPerUnit, meters: d.meters })),
        downtimes: downtimes.map((dt) => ({ reasonId: dt.reasonId, duration: dt.duration, comment: dt.comment || undefined })),
      };
      const res = await authFetch('/api/reports/upsert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await res.json().catch(() => null);
      if (!res.ok) throw new Error(result?.error || 'Ошибка отправки отчёта');
      toast.success('Отчёт успешно отправлен!'); hapticSuccess();
      pushClientFeedback({ level: 'success', scope: 'reports', action: 'report.submit.client_succeeded', title: 'Отчёт отправлен', message: 'Сменный отчёт был успешно сохранён.', requestId: result?.requestId || res.headers.get('x-request-id') });
      if (user && selectedSiteId && date) localStorage.removeItem(`report-draft-${user.id}-${selectedSiteId}-${date}`);
      // Show the confirmation screen instead of redirecting silently; its
      // "Готово" button takes the operator back to /operator.
      setSubmittedAt(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Ошибка отправки';
      toast.error(message); hapticError();
      pushClientFeedback({ level: 'warn', scope: 'reports', action: 'report.submit.client_failed', title: 'Отчёт не отправлен', message });
    } finally { setSubmitting(false); }
  };

  return {
    reportId, date, setDate, shiftStart, setShiftStart, shiftEnd, setShiftEnd,
    sites, siteTree, setSiteTree, selectedSiteId: selectedSiteId || '', setSelectedSiteId: setSelectedSite,
    pileGrades, drillingTypes, downtimeReasons, equipment, selectedEquipmentId, setSelectedEquipmentId,
    selectedFieldId, setSelectedFieldId, selectedClusterId, setSelectedClusterId, selectedPicketId, setSelectedPicketId,
    piles, setPiles, drillings, setDrillings, downtimes, setDowntimes,
    showDowntime, setShowDowntime, quickMode, setQuickMode,
    loading, loadError, reloadData: loadData, submitting, submittedAt, loadingReport,
    addPile, addDrilling, addDowntime, removePile, removeDrilling, removeDowntime,
    handleSubmit, getPileMetersPerUnit, getPicketPath,
    getPileGradeName, getDrillTypeName, getDowntimeReasonName,
    loadSiteTree,
  };
}
