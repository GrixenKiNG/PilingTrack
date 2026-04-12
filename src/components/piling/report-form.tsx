'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Send,
  Loader2,
  MapPin,
  HardHat,
  Drill,
  Clock,
  AlertTriangle,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import { usePilingStore } from '@/lib/store';
import { authFetch } from '@/lib/api';
import { pushClientFeedback } from '@/lib/client-feedback';
import { formatNumber } from '@/lib/format';
import { hapticClick, hapticSuccess, hapticError } from '@/lib/haptic-feedback';
import { getTodayInTimezone } from '@/lib/timezone';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type {
  SiteWithTreeDTO,
  PileGradeDTO,
  DrillingTypeDTO,
  DowntimeReasonDTO,
  CreateReportPayload,
} from '@/lib/types';

interface PileEntry {
  id: string;
  picketId: string;
  pileGradeId: string;
  count: number;
}

interface DrillingEntry {
  id: string;
  picketId: string;
  typeId: string;
  count: number;
  metersPerUnit: number;
  meters: number;
}

interface DowntimeEntry {
  id: string;
  reasonId: string;
  duration: number;
  comment: string;
}

function parsePileLengthFromGradeName(name: string) {
  const normalized = name.replace(',', '.');
  const match = normalized.match(/(\d{1,2})(?:\.\d+)?(?:\s*x\s*\d+(?:\.\d+)?)?$/i)
    || normalized.match(/(\d{1,2})\.\d+/);

  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function ReportForm() {
  const user = usePilingStore((s) => s.currentUser);
  const router = useRouter();
  const selectedSiteId = usePilingStore((s) => s.selectedSiteId);
  const setSelectedSite = usePilingStore((s) => s.setSelectedSite);

  const [reportId, setReportId] = useState('');
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

  // Cascading dropdown state
  const [selectedFieldId, setSelectedFieldId] = useState('');
  const [selectedClusterId, setSelectedClusterId] = useState('');
  const [selectedPicketId, setSelectedPicketId] = useState('');

  // Form entries
  const [piles, setPiles] = useState<PileEntry[]>([]);
  const [drillings, setDrillings] = useState<DrillingEntry[]>([]);
  const [downtimes, setDowntimes] = useState<DowntimeEntry[]>([]);

  // Temp form state for adding items
  const [tempPileGrade, setTempPileGrade] = useState('');
  const [tempPileCount, setTempPileCount] = useState('');
  const [tempDrillType, setTempDrillType] = useState('');
  const [tempDrillCount, setTempDrillCount] = useState('');
  const [tempDrillMetersPerUnit, setTempDrillMetersPerUnit] = useState('');
  const [tempDowntimeReason, setTempDowntimeReason] = useState('');
  const [tempDowntimeDuration, setTempDowntimeDuration] = useState('');
  const [tempDowntimeComment, setTempDowntimeComment] = useState('');

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showDowntime, setShowDowntime] = useState(false);
  const [quickMode, setQuickMode] = useState(true);

  // Derived filtered data for cascading dropdowns
  const fields = siteTree?.fields || [];
  const selectedField = fields.find((f) => f.id === selectedFieldId);
  const clusters = selectedField?.clusters || [];
  const selectedCluster = clusters.find((c) => c.id === selectedClusterId);
  const pickets = selectedCluster?.pickets || [];
  const getPileMetersPerUnit = useCallback(
    (pileGradeId: string) => {
      const gradeName = pileGrades.find((grade) => grade.id === pileGradeId)?.name || '';
      const parsedLength = parsePileLengthFromGradeName(gradeName);

      if (parsedLength !== null) {
        return parsedLength;
      }

      return siteTree?.pilePlans?.find((plan) => plan.pileGradeId === pileGradeId)?.metersPerUnit || 0;
    },
    [pileGrades, siteTree]
  );

  // Load sites, dictionary, and existing report
  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [sitesRes, dictRes] = await Promise.all([
        authFetch(`/api/sites?userId=${user.id}`),
        authFetch('/api/dictionary/all'),
      ]);

      if (sitesRes.ok) {
        const data = await sitesRes.json();
        setSites(data.data || data.sites || []);
      }

      if (dictRes.ok) {
        const dictData = await dictRes.json();
        setPileGrades(dictData.pileGrades || []);
        setDrillingTypes(dictData.drillingTypes || []);
        setDowntimeReasons(dictData.downtimeReasons || []);
      }

      // Load equipment — filtered by site when available
      try {
        const eqUrl = selectedSiteId ? `/api/equipment?siteId=${selectedSiteId}` : '/api/equipment';
        const eqRes = await authFetch(eqUrl);
        if (eqRes.ok) {
          const eqData = await eqRes.json();
          setEquipment((eqData.data || eqData.equipment || []).map((e: { id: string; name: string }) => ({ id: e.id, name: e.name })));
        }
      } catch {
        // ignore
      }

      // Load existing report for today
      if (selectedSiteId) {
        const reportRes = await authFetch(
          `/api/reports/edit?userId=${user.id}&siteId=${selectedSiteId}&date=${date}`
        );
        if (reportRes.ok) {
          const reportData = await reportRes.json();
          if (reportData.report) {
            const r = reportData.report;
            // Use existing report's ID for upsert (edit mode)
            setReportId(r.reportId || '');
            if (r.shiftStart) setShiftStart(r.shiftStart);
            if (r.shiftEnd) setShiftEnd(r.shiftEnd);
            if (r.equipmentId) setSelectedEquipmentId(r.equipmentId);
            if (r.piles?.length > 0) {
              setPiles(
                r.piles.map((p: { id: string; picketId: string | null; pileGradeId: string; count: number }) => ({
                  id: p.id,
                  picketId: p.picketId || '',
                  pileGradeId: p.pileGradeId,
                  count: p.count,
                }))
              );
            }
            if (r.drillings?.length > 0) {
              setDrillings(
                r.drillings.map((d: { id: string; picketId: string | null; typeId: string; count?: number; metersPerUnit?: number; meters: number }) => ({
                  id: d.id,
                  picketId: d.picketId || '',
                  typeId: d.typeId,
                  count: d.count || 1,
                  metersPerUnit: d.metersPerUnit || 0,
                  meters: d.meters,
                }))
              );
            }
            if (r.downtimes?.length > 0) {
              setDowntimes(
                r.downtimes.map((dt: { id: string; reasonId: string; duration: number; comment: string | null }) => ({
                  id: dt.id,
                  reasonId: dt.reasonId,
                  duration: dt.duration,
                  comment: dt.comment || '',
                }))
              );
              setShowDowntime(true);
            }
          }
        }
      }
    } catch {
      toast.error('Ошибка загрузки данных');
    } finally {
      setLoading(false);
    }
  }, [user, selectedSiteId, date]);

  // Load site tree when site changes
  useEffect(() => {
    if (!date) {
      setDate(getTodayInTimezone());
    }
  }, [date]);

  useEffect(() => {
    setSelectedEquipmentId('');
    if (selectedSiteId) {
      authFetch(`/api/sites/${selectedSiteId}`)
        .then((res) => res.ok ? res.json() : null)
        .then((data) => {
          if (data?.site) setSiteTree(data.site);
        })
        .catch((err) => {
          console.error('[ReportForm] Failed to load site tree:', err);
        });
    }
  }, [selectedSiteId]);

  useEffect(() => {
    if (!date) return;
    loadData();
  }, [date, loadData]);

  // ============================================================
  // Draft autosave — every 30 seconds + on unload
  // ============================================================
  useEffect(() => {
    if (!user || !selectedSiteId || !date) return;

    const draftKey = `report-draft-${user.id}-${selectedSiteId}-${date}`;

    const saveDraft = () => {
      if (piles.length > 0 || drillings.length > 0 || downtimes.length > 0) {
        const draft = {
          piles,
          drillings,
          downtimes,
          shiftStart,
          shiftEnd,
          selectedEquipmentId,
          selectedFieldId,
          selectedClusterId,
          selectedPicketId,
          savedAt: new Date().toISOString(),
        };
        localStorage.setItem(draftKey, JSON.stringify(draft));
      }
    };

    const interval = setInterval(saveDraft, 30_000);
    window.addEventListener('beforeunload', saveDraft);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', saveDraft);
    };
  }, [
    piles, drillings, downtimes, shiftStart, shiftEnd,
    selectedEquipmentId, selectedFieldId, selectedClusterId, selectedPicketId,
    user, selectedSiteId, date,
  ]);

  // ============================================================
  // Draft restore — on mount / date / site change
  // ============================================================
  useEffect(() => {
    if (!user || !selectedSiteId || !date) return;

    const draftKey = `report-draft-${user.id}-${selectedSiteId}-${date}`;
    const draftStr = localStorage.getItem(draftKey);

    if (!draftStr) return;

    try {
      const draft = JSON.parse(draftStr);
      const savedAt = new Date(draft.savedAt);
      const hoursAgo = (Date.now() - savedAt.getTime()) / (1000 * 60 * 60);

      if (hoursAgo > 24) {
        localStorage.removeItem(draftKey);
        return;
      }

      // Only restore if form is empty (no existing report loaded)
      if (piles.length === 0 && drillings.length === 0 && downtimes.length === 0) {
        if (draft.piles?.length) setPiles(draft.piles);
        if (draft.drillings?.length) setDrillings(draft.drillings);
        if (draft.downtimes?.length) {
          setDowntimes(draft.downtimes);
          setShowDowntime(true);
        }
        if (draft.shiftStart) setShiftStart(draft.shiftStart);
        if (draft.shiftEnd) setShiftEnd(draft.shiftEnd);
        if (draft.selectedEquipmentId) setSelectedEquipmentId(draft.selectedEquipmentId);
        if (draft.selectedFieldId) setSelectedFieldId(draft.selectedFieldId);
        if (draft.selectedClusterId) setSelectedClusterId(draft.selectedClusterId);
        if (draft.selectedPicketId) setSelectedPicketId(draft.selectedPicketId);

        toast.info('Восстановлен черновик', {
          description: `Сохранён ${savedAt.toLocaleString('ru-RU')}`,
        });
      }
    } catch {
      localStorage.removeItem(draftKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, selectedSiteId, date]);

  // Reset child dropdowns when parent changes
  const handleFieldChange = (val: string) => {
    setSelectedFieldId(val);
    setSelectedClusterId('');
    setSelectedPicketId('');
  };

  const handleClusterChange = (val: string) => {
    setSelectedClusterId(val);
    setSelectedPicketId('');
  };

  // Add pile entry
  const addPile = () => {
    if (!tempPileGrade || !tempPileCount || Number(tempPileCount) <= 0) {
      toast.error('Заполните марку и количество');
      return;
    }
    const newEntry: PileEntry = {
      id: crypto.randomUUID(),
      picketId: selectedPicketId,
      pileGradeId: tempPileGrade,
      count: Number(tempPileCount),
    };
    setPiles((prev) => [...prev, newEntry]);
    setTempPileGrade('');
    setTempPileCount('');
    setSelectedPicketId('');
    hapticClick();
    toast.success('Свая добавлена');
  };

  // Add drilling entry
  const addDrilling = () => {
    if (
      !tempDrillType ||
      !tempDrillCount ||
      !tempDrillMetersPerUnit ||
      Number(tempDrillCount) <= 0 ||
      Number(tempDrillMetersPerUnit) <= 0
    ) {
      toast.error('Заполните тип бурения, количество и метры на единицу');
      return;
    }
    const newEntry: DrillingEntry = {
      id: crypto.randomUUID(),
      picketId: selectedPicketId,
      typeId: tempDrillType,
      count: Number(tempDrillCount),
      metersPerUnit: Number(tempDrillMetersPerUnit),
      meters: Number((Number(tempDrillCount) * Number(tempDrillMetersPerUnit)).toFixed(1)),
    };
    setDrillings((prev) => [...prev, newEntry]);
    setTempDrillType('');
    setTempDrillCount('');
    setTempDrillMetersPerUnit('');
    setSelectedPicketId('');
    toast.success('Бурение добавлено');
  };

  // Add downtime entry
  const addDowntime = () => {
    if (!tempDowntimeReason || !tempDowntimeDuration || Number(tempDowntimeDuration) <= 0) {
      toast.error('Заполните причину и длительность');
      return;
    }
    const newEntry: DowntimeEntry = {
      id: crypto.randomUUID(),
      reasonId: tempDowntimeReason,
      duration: Number(tempDowntimeDuration),
      comment: tempDowntimeComment,
    };
    setDowntimes((prev) => [...prev, newEntry]);
    setTempDowntimeReason('');
    setTempDowntimeDuration('');
    setTempDowntimeComment('');
    toast.success('Простой добавлен');
  };

  // Submit report
  const handleSubmit = async () => {
    if (!selectedSiteId || !user) {
      toast.error('Выберите объект');
      return;
    }
    if (piles.length === 0 && drillings.length === 0) {
      toast.error('Добавьте хотя бы одну сваю или бурение');
      return;
    }

    // Use existing reportId if loaded, otherwise generate new
    const finalReportId = reportId || crypto.randomUUID();

    setSubmitting(true);
    try {
      const payload: CreateReportPayload = {
        reportId: finalReportId,
        userId: user.id,
        siteId: selectedSiteId,
        date,
        shiftStart,
        shiftEnd,
        equipmentId: selectedEquipmentId || undefined,
        piles: piles.map((p) => ({
          picketId: p.picketId || undefined,
          pileGradeId: p.pileGradeId,
          count: p.count,
        })),
        drillings: drillings.map((d) => ({
          picketId: d.picketId || undefined,
          typeId: d.typeId,
          count: d.count,
          metersPerUnit: d.metersPerUnit,
          meters: d.meters,
        })),
        downtimes: downtimes.map((dt) => ({
          reasonId: dt.reasonId,
          duration: dt.duration,
          comment: dt.comment || undefined,
        })),
      };

      const res = await authFetch('/api/reports/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await res.json().catch(() => null);

      if (!res.ok) throw new Error(result?.error || 'Ошибка отправки отчёта');

      toast.success('Отчёт успешно отправлен!');
      hapticSuccess(); // Tactile feedback for mobile operators
      pushClientFeedback({
        level: 'success',
        scope: 'reports',
        action: 'report.submit.client_succeeded',
        title: 'Отчёт отправлен',
        message: 'Сменный отчёт был успешно сохранён.',
        requestId: result?.requestId || res.headers.get('x-request-id'),
      });
      // Clear draft after successful submit
      if (user && selectedSiteId && date) {
        localStorage.removeItem(`report-draft-${user.id}-${selectedSiteId}-${date}`);
      }
      router.push('/operator');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Ошибка отправки';
      toast.error(message);
      hapticError(); // Tactile feedback for errors
      pushClientFeedback({
        level: 'warn',
        scope: 'reports',
        action: 'report.submit.client_failed',
        title: 'Отчёт не отправлен',
        message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const totalPiles = piles.reduce((sum, p) => sum + p.count, 0);
  const totalPileMeters = piles.reduce((sum, pile) => sum + pile.count * getPileMetersPerUnit(pile.pileGradeId), 0);
  const totalMeters = drillings.reduce((sum, d) => sum + d.meters, 0);
  const totalDowntime = downtimes.reduce((sum, d) => sum + d.duration, 0);
  const tempPileMeters = tempPileGrade && tempPileCount
    ? Number(tempPileCount || 0) * getPileMetersPerUnit(tempPileGrade)
    : 0;
  const tempDrillingVolume = Number(tempDrillCount || 0) * Number(tempDrillMetersPerUnit || 0);

  const getPileGradeName = (id: string) =>
    pileGrades.find((g) => g.id === id)?.name || id;
  const getDrillTypeName = (id: string) =>
    drillingTypes.find((t) => t.id === id)?.name || id;
  const getDowntimeReasonName = (id: string) =>
    downtimeReasons.find((r) => r.id === id)?.name || id;

  const getPicketPath = (picketId: string) => {
    if (!picketId || !siteTree) return '';
    for (const field of siteTree.fields) {
      for (const cluster of field.clusters) {
        const picket = cluster.pickets.find((p) => p.id === picketId);
        if (picket) return `${field.name} → ${cluster.name} → ${picket.name}`;
      }
    }
    return '';
  };

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => router.push('/operator')}
          className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-slate-100 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold text-slate-900 truncate">
            Отчёт за смену
          </h1>
          <p className="text-xs text-slate-500 truncate">
            {sites.find((s) => s.id === selectedSiteId)?.name || 'Выберите объект'}
          </p>
        </div>
      </div>

      {/* Scrollable Form */}
      <div className="flex-1 overflow-y-auto pb-24">
        <div className="p-4 space-y-4">
          {/* Date & Shift */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-slate-600">Дата</Label>
                  <Input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="h-11 font-mono"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-slate-600">Начало смены</Label>
                  <Input
                    type="time"
                    value={shiftStart}
                    onChange={(e) => setShiftStart(e.target.value)}
                    className="h-11 font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-slate-600">Конец смены</Label>
                  <Input
                    type="time"
                    value={shiftEnd}
                    onChange={(e) => setShiftEnd(e.target.value)}
                    className="h-11 font-mono"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Site Selector */}
          <Card>
            <CardContent className="p-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" />
                  Объект
                </Label>
                <Select
                  value={selectedSiteId || ''}
                  onValueChange={(val) => setSelectedSite(val)}
                >
                  <SelectTrigger className="w-full h-11">
                    <SelectValue placeholder="Выберите объект" />
                  </SelectTrigger>
                  <SelectContent>
                    {sites.map((site) => (
                      <SelectItem key={site.id} value={site.id}>
                        {site.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Equipment selector */}
          <Card>
            <CardContent className="p-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                  <Wrench className="w-3.5 h-3.5" />
                  Установка
                </Label>
                <Select value={selectedEquipmentId} onValueChange={setSelectedEquipmentId}>
                  <SelectTrigger className="w-full h-11">
                    <SelectValue placeholder="Выберите установку..." />
                  </SelectTrigger>
                  <SelectContent>
                    {equipment.map((eq) => (
                      <SelectItem key={eq.id} value={eq.id}>{eq.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Cascading Context Selection */}
          {selectedSiteId && siteTree && fields.length > 0 && (
            <Card>
              <CardContent className="p-4 space-y-3">
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-orange-500" />
                  Привязка к объекту
                </h3>

                {/* Field */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-slate-600">
                    Свайное поле
                  </Label>
                  <Select value={selectedFieldId} onValueChange={handleFieldChange}>
                    <SelectTrigger className="w-full h-11">
                      <SelectValue placeholder="Выберите свайное поле..." />
                    </SelectTrigger>
                    <SelectContent>
                      {fields.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Cluster */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-slate-600">Куст</Label>
                  <Select
                    value={selectedClusterId}
                    onValueChange={handleClusterChange}
                    disabled={!selectedFieldId}
                  >
                    <SelectTrigger className="w-full h-11">
                      <SelectValue
                        placeholder={
                          !selectedFieldId
                            ? 'Сначала выберите поле'
                            : 'Выберите куст...'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {clusters.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Picket */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-slate-600">Пикет</Label>
                  <Select
                    value={selectedPicketId}
                    onValueChange={setSelectedPicketId}
                    disabled={!selectedClusterId}
                  >
                    <SelectTrigger className="w-full h-11">
                      <SelectValue
                        placeholder={
                          !selectedClusterId
                            ? 'Сначала выберите куст'
                            : 'Выберите пикет...'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {pickets.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Section: Piles */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <HardHat className="w-4 h-4 text-orange-500" />
                    Забитые сваи
                  </h3>
                  <div className="flex items-center gap-2">
                    {totalPiles > 0 && (
                      <span className="text-xs font-mono font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">
                        {totalPiles} шт. / {formatNumber(totalPileMeters)} м.п.
                      </span>
                    )}
                    <button
                      onClick={() => setQuickMode(!quickMode)}
                      className="text-xs text-blue-600 hover:text-blue-700 font-medium min-w-[44px] min-h-[44px] flex items-center justify-center"
                    >
                      {quickMode ? 'Расширенный' : 'Простой'} режим
                    </button>
                  </div>
                </div>

                {quickMode ? (
                  // Quick mode: just grade + count
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Select value={tempPileGrade} onValueChange={setTempPileGrade}>
                        <SelectTrigger className="flex-1 h-12 min-h-[48px]">
                          <SelectValue placeholder="Марка сваи..." />
                        </SelectTrigger>
                        <SelectContent>
                          {pileGrades.map((g) => (
                            <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        placeholder="Кол-во"
                        value={tempPileCount}
                        onChange={(e) => setTempPileCount(e.target.value)}
                        min="1"
                        className="w-24 h-12 min-h-[48px] font-mono text-lg"
                      />
                      <Button
                        onClick={addPile}
                        min-w={48}
                        min-h={48}
                        className="h-12 min-h-[48px] w-12 bg-orange-500 hover:bg-orange-600 text-white"
                      >
                        <Plus className="w-5 h-5" />
                      </Button>
                    </div>
                    {tempPileGrade && tempPileCount && Number(tempPileCount) <= 0 && (
                      <p className="text-red-500 text-xs" role="alert">Количество должно быть больше 0</p>
                    )}
                    {!tempPileGrade && (
                      <p className="text-slate-400 text-xs">Выберите марку сваи</p>
                    )}
                    {(tempPileGrade || tempPileCount) && Number(tempPileCount) > 0 && (
                      <div className="rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-700">
                        Автоподсчёт: {tempPileCount || 0} шт. x {formatNumber(getPileMetersPerUnit(tempPileGrade))} м.п. = {formatNumber(tempPileMeters)} м.п.
                      </div>
                    )}
                  </div>
                ) : (
                  // Advanced mode: full cascading dropdowns
                  <div className="space-y-2">
                    <Select value={tempPileGrade} onValueChange={setTempPileGrade}>
                      <SelectTrigger className="w-full h-11">
                        <SelectValue placeholder="Марка сваи..." />
                      </SelectTrigger>
                      <SelectContent>
                        {pileGrades.map((g) => (
                          <SelectItem key={g.id} value={g.id}>
                            {g.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        placeholder="Количество, шт."
                        value={tempPileCount}
                        onChange={(e) => setTempPileCount(e.target.value)}
                        min="1"
                        className="h-11 font-mono"
                      />
                      <Button
                        onClick={addPile}
                        className="h-11 bg-orange-500 hover:bg-orange-600 text-white px-4"
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>
                    {tempPileGrade && tempPileCount && Number(tempPileCount) <= 0 && (
                      <p className="text-red-500 text-xs" role="alert">Количество должно быть больше 0</p>
                    )}
                    {(tempPileGrade || tempPileCount) && (
                      <div className="rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-700">
                        Автоподсчёт: {tempPileCount || 0} шт. x {formatNumber(getPileMetersPerUnit(tempPileGrade))} м.п. = {formatNumber(tempPileMeters)} м.п.
                      </div>
                    )}
                  </div>
                )}

                {piles.length > 0 && (
                  <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                    {piles.map((pile) => (
                      <div
                        key={pile.id}
                        className="flex items-center justify-between p-3 bg-slate-50 rounded-lg"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900">
                            {getPileGradeName(pile.pileGradeId)}
                          </p>
                          {pile.picketId && (
                            <p className="text-[10px] text-slate-500 truncate">
                              {getPicketPath(pile.picketId)}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-right text-sm font-bold text-slate-900">
                            <span className="block font-mono">{pile.count} шт.</span>
                            <span className="block text-xs text-slate-500">{formatNumber(pile.count * getPileMetersPerUnit(pile.pileGradeId))} м.п.</span>
                          </span>
                          <button
                            onClick={() =>
                              setPiles((prev) => prev.filter((p) => p.id !== pile.id))
                            }
                            className="min-w-[44px] min-h-[44px] p-2 rounded-lg flex items-center justify-center hover:bg-red-100 text-slate-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

                    {/* Section: Drilling */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
          >
            <Card>
              <CardHeader className="pb-3 pt-4 px-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Drill className="w-4 h-4 text-blue-500" />
                    Лидерное бурение
                  </CardTitle>
                  {totalMeters > 0 && (
                    <span className="text-xs font-mono font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                      {formatNumber(totalMeters)} м
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                <div className="space-y-2">
                  <Select value={tempDrillType} onValueChange={setTempDrillType}>
                    <SelectTrigger className="w-full h-11">
                      <SelectValue placeholder="Тип бурения..." />
                    </SelectTrigger>
                    <SelectContent>
                      {drillingTypes.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                    <Input
                      type="number"
                      placeholder="Количество, шт."
                      value={tempDrillCount}
                      onChange={(e) => setTempDrillCount(e.target.value)}
                      min="1"
                      className="h-11 font-mono"
                    />
                    <Input
                      type="number"
                      step="0.1"
                      placeholder="Метры на 1 шт."
                      value={tempDrillMetersPerUnit}
                      onChange={(e) => setTempDrillMetersPerUnit(e.target.value)}
                      min="0.1"
                      className="h-11 font-mono"
                    />
                    <Button
                      onClick={addDrilling}
                      className="h-11 bg-blue-500 hover:bg-blue-600 text-white px-4"
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                  {(tempDrillCount || tempDrillMetersPerUnit) && (
                    <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
                      Автоподсчёт: {tempDrillCount || 0} шт. x {tempDrillMetersPerUnit || 0} м = {formatNumber(tempDrillingVolume)} м
                    </div>
                  )}
                </div>

                {drillings.length > 0 && (
                  <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                    {drillings.map((drill) => (
                      <div
                        key={drill.id}
                        className="flex items-center justify-between p-3 bg-slate-50 rounded-lg"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900">
                            {getDrillTypeName(drill.typeId)}
                          </p>
                          {drill.picketId && (
                            <p className="text-[10px] text-slate-500 truncate">
                              {getPicketPath(drill.picketId)}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-right text-sm font-bold text-slate-900">
                            <span className="block font-mono">{drill.count} шт. x {formatNumber(drill.metersPerUnit)} м</span>
                            <span className="block text-xs text-slate-500">Объём: {formatNumber(drill.meters)} м</span>
                          </span>
                          <button
                            onClick={() =>
                              setDrillings((prev) =>
                                prev.filter((d) => d.id !== drill.id)
                              )
                            }
                            className="min-w-[44px] min-h-[44px] p-2 rounded-lg flex items-center justify-center hover:bg-red-100 text-slate-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Section: Downtime (optional) */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Card>
              <CardHeader className="pb-3 pt-4 px-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-500" />
                    Простой техники
                  </CardTitle>
                  <button
                    onClick={() => setShowDowntime(!showDowntime)}
                    className="text-xs text-orange-500 font-medium"
                  >
                    {showDowntime ? 'Скрыть' : '+ Добавить'}
                  </button>
                </div>
              </CardHeader>
              {showDowntime && (
                <CardContent className="px-4 pb-4 space-y-3">
                  <div className="space-y-2">
                    <Select
                      value={tempDowntimeReason}
                      onValueChange={setTempDowntimeReason}
                    >
                      <SelectTrigger className="w-full h-11">
                        <SelectValue placeholder="Причина простоя..." />
                      </SelectTrigger>
                      <SelectContent>
                        {downtimeReasons.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        step="0.5"
                        placeholder="Часы"
                        value={tempDowntimeDuration}
                        onChange={(e) => setTempDowntimeDuration(e.target.value)}
                        min="0.5"
                        className="h-11 font-mono flex-1"
                      />
                      <Button
                        onClick={addDowntime}
                        className="h-11 bg-amber-500 hover:bg-amber-600 text-white px-4"
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>
                    <Input
                      placeholder="Комментарий (необязательно)"
                      value={tempDowntimeComment}
                      onChange={(e) => setTempDowntimeComment(e.target.value)}
                      className="h-11"
                    />
                  </div>

                  {downtimes.length > 0 && (
                    <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                      {downtimes.map((dt) => (
                        <div
                          key={dt.id}
                          className="flex items-center justify-between p-3 bg-slate-50 rounded-lg"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-900">
                              {getDowntimeReasonName(dt.reasonId)}
                            </p>
                            {dt.comment && (
                              <p className="text-[10px] text-slate-500 truncate">
                                {dt.comment}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-mono font-bold text-amber-600">
                              {dt.duration} ч
                            </span>
                            <button
                              onClick={() =>
                                setDowntimes((prev) =>
                                  prev.filter((d) => d.id !== dt.id)
                                )
                              }
                              className="min-w-[44px] min-h-[44px] p-2 rounded-lg flex items-center justify-center hover:bg-red-100 text-slate-400 hover:text-red-500 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {totalDowntime > 0 && (
                    <div className="text-xs text-slate-500 text-right">
                      Итого: <span className="font-mono font-bold">{totalDowntime} ч</span>
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          </motion.div>

          {/* Summary */}
          {(piles.length > 0 || drillings.length > 0 || downtimes.length > 0) && (
            <Card className="bg-slate-900 text-white border-0">
              <CardContent className="p-4">
                <h3 className="text-xs font-medium text-slate-400 mb-3">
                  Итого за смену
                </h3>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-lg font-bold font-mono tabular-nums">
                      {totalPiles} шт. / {formatNumber(totalPileMeters)} м.п.
                    </p>
                    <p className="text-[10px] text-slate-400">Сваи, шт. / м.п.</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold font-mono tabular-nums">
                      {formatNumber(totalMeters)} м
                    </p>
                    <p className="text-[10px] text-slate-400">Лидерное бурение</p>
                  </div>
                  {downtimes.length > 0 && (
                    <div>
                      <p className="text-lg font-bold font-mono tabular-nums text-amber-400">
                        {formatNumber(totalDowntime)} ч
                      </p>
                      <p className="text-[10px] text-slate-400">Простой</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Sticky Submit Button — always clickable, shows guidance */}
      <div className="fixed bottom-0 left-0 right-0 z-20 bg-white/95 backdrop-blur-sm border-t px-4 py-3 pb-safe">
        {/* Hint line when something is missing */}
        {!submitting && (!selectedSiteId || (piles.length === 0 && drillings.length === 0)) && (
          <div className="flex items-center gap-1.5 mb-2 justify-center">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            <p className="text-xs text-amber-600 font-medium">
              {!selectedSiteId
                ? 'Сначала выберите объект выше'
                : 'Добавьте хотя бы одну сваю или бурение'}
            </p>
          </div>
        )}
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className={cn(
            'w-full h-14 rounded-lg font-semibold text-base flex items-center justify-center transition-all',
            submitting
              ? 'bg-orange-400 text-white cursor-wait'
              : (!selectedSiteId || (piles.length === 0 && drillings.length === 0))
                ? 'bg-orange-500/20 text-orange-400 cursor-pointer hover:bg-orange-500/30'
                : 'bg-orange-500 hover:bg-orange-600 text-white active:scale-[0.98]'
          )}
        >
          {submitting ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Отправка...
            </>
          ) : (
            <>
              <Send className="w-5 h-5 mr-2" />
              Отправить отчёт
            </>
          )}
        </button>
      </div>
    </div>
  );
}
