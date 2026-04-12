'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  FileText,
  HardHat,
  Drill,
  Clock,
  Filter,
  CalendarDays,
  Loader2,
  User,
  Plus,
  Trash2,
  Pencil,
  FileDown,
  RotateCcw,
  Eye,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { formatNumber, pluralizeRu } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PdfPreviewDialog } from '@/components/piling/pdf-preview-dialog';
import type {
  ReportDTO,
  SiteFlatDTO,
  PileGradeDTO,
  DrillingTypeDTO,
  DowntimeReasonDTO,
} from '@/lib/types';

// ── Types for form entries ──

interface OperatorUser {
  id: string;
  name: string;
}

interface PileEntry {
  id: string;
  pileGradeId: string;
  count: number;
}

interface DrillingEntry {
  id: string;
  typeId: string;
  meters: number;
}

interface DowntimeEntry {
  id: string;
  reasonId: string;
  duration: number;
  comment: string;
}

interface PeriodSummary {
  totalPiles: number;
  totalDrilling: number;
  totalDowntime: number;
  reportCount: number;
}

export function AdminReports() {
  const [reports, setReports] = useState<ReportDTO[]>([]);
  const [sites, setSites] = useState<SiteFlatDTO[]>([]);
  const [operators, setOperators] = useState<OperatorUser[]>([]);
  const [pileGrades, setPileGrades] = useState<PileGradeDTO[]>([]);
  const [drillingTypes, setDrillingTypes] = useState<DrillingTypeDTO[]>([]);
  const [downtimeReasons, setDowntimeReasons] = useState<DowntimeReasonDTO[]>([]);
  const [equipment, setEquipment] = useState<{ id: string; name: string }[]>([]);

  // Filters
  const [filterSiteId, setFilterSiteId] = useState<string>('all');
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  const [periodActive, setPeriodActive] = useState(false);
  const [periodSummary, setPeriodSummary] = useState<PeriodSummary | null>(null);

  // Loading states
  const [loading, setLoading] = useState(true);
  const [loadingSites, setLoadingSites] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [previewReportId, setPreviewReportId] = useState<string | null>(null);
  const [previewReportName, setPreviewReportName] = useState<string>('');

  // Dialogs
  const [selectedReport, setSelectedReport] = useState<ReportDTO | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Create/Edit form state
  const [editReport, setEditReport] = useState<ReportDTO | null>(null);
  const [formUserId, setFormUserId] = useState('');
  const [formSiteId, setFormSiteId] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formShiftStart, setFormShiftStart] = useState('08:00');
  const [formShiftEnd, setFormShiftEnd] = useState('20:00');
  const [formPiles, setFormPiles] = useState<PileEntry[]>([]);
  const [formDrillings, setFormDrillings] = useState<DrillingEntry[]>([]);
  const [formDowntimes, setFormDowntimes] = useState<DowntimeEntry[]>([]);
  const [formEquipmentId, setFormEquipmentId] = useState('');
  const [showFormDowntime, setShowFormDowntime] = useState(false);

  // Temp form fields
  const [tempPileGrade, setTempPileGrade] = useState('');
  const [tempPileCount, setTempPileCount] = useState('');
  const [tempDrillType, setTempDrillType] = useState('');
  const [tempDrillMeters, setTempDrillMeters] = useState('');
  const [tempDtReason, setTempDtReason] = useState('');
  const [tempDtDuration, setTempDtDuration] = useState('');
  const [tempDtComment, setTempDtComment] = useState('');

  useEffect(() => {
    if (!formDate) {
      setFormDate(new Date().toISOString().split('T')[0]);
    }
  }, [formDate]);

  // ── Data loading ──

  const loadSites = useCallback(async () => {
    setLoadingSites(true);
    try {
      const res = await authFetch('/api/sites/all');
      if (res.ok) {
        const data = await res.json();
        setSites(data.sites || []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingSites(false);
    }
  }, []);

  const loadOperators = useCallback(async () => {
    try {
      const res = await authFetch('/api/users?role=OPERATOR');
      if (res.ok) {
        const data = await res.json();
        setOperators((data.users || []).map((u: { id: string; name: string }) => ({ id: u.id, name: u.name })));
      }
    } catch {
      // ignore
    }
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
    } catch {
      // ignore
    }
  }, []);

  const loadEquipment = useCallback(async () => {
    try {
      const res = await authFetch('/api/equipment');
      if (res.ok) {
        const data = await res.json();
        setEquipment((data.data || data.equipment || []).map((e: { id: string; name: string }) => ({ id: e.id, name: e.name })));
      }
    } catch {
      // ignore
    }
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

  // ── Period filter ──

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

  // ── Create/Edit dialog ──

  const openCreateDialog = () => {
    setEditReport(null);
    setFormUserId('');
    setFormSiteId('');
    setFormDate(new Date().toISOString().split('T')[0]);
    setFormShiftStart('08:00');
    setFormShiftEnd('20:00');
    setFormPiles([]);
    setFormDrillings([]);
    setFormDowntimes([]);
    setFormEquipmentId('');
    setShowFormDowntime(false);
    resetTempFields();
    setShowCreateDialog(true);
  };

  const openEditDialog = (report: ReportDTO) => {
    setEditReport(report);
    setFormUserId(report.userId);
    setFormSiteId(report.siteId);
    setFormDate(report.date);
    setFormShiftStart(report.shiftStart || '08:00');
    setFormShiftEnd(report.shiftEnd || '20:00');
    setFormPiles(
      report.piles.map((p) => ({
        id: p.id,
        pileGradeId: p.pileGradeId,
        count: p.count,
      }))
    );
    setFormDrillings(
      report.drillings.map((d) => ({
        id: d.id,
        typeId: d.typeId,
        meters: d.meters,
      }))
    );
    setFormDowntimes(
      report.downtimes.map((dt) => ({
        id: dt.id,
        reasonId: dt.reasonId,
        duration: dt.duration,
        comment: dt.comment || '',
      }))
    );
    setFormEquipmentId(report.equipment?.id || '');
    setShowFormDowntime(report.downtimes.length > 0);
    resetTempFields();
    setShowCreateDialog(true);
  };

  const resetTempFields = () => {
    setTempPileGrade('');
    setTempPileCount('');
    setTempDrillType('');
    setTempDrillMeters('');
    setTempDtReason('');
    setTempDtDuration('');
    setTempDtComment('');
  };

  const closeDialog = () => {
    setShowCreateDialog(false);
    setEditReport(null);
    resetTempFields();
  };

  // ── Form actions ──

  const addPile = () => {
    if (!tempPileGrade || !tempPileCount || Number(tempPileCount) <= 0) {
      toast.error('Заполните марку и количество');
      return;
    }
    setFormPiles((prev) => [
      ...prev,
      { id: crypto.randomUUID(), pileGradeId: tempPileGrade, count: Number(tempPileCount) },
    ]);
    setTempPileGrade('');
    setTempPileCount('');
    toast.success('Свая добавлена');
  };

  const addDrilling = () => {
    if (!tempDrillType || !tempDrillMeters || Number(tempDrillMeters) <= 0) {
      toast.error('Заполните тип и метры');
      return;
    }
    setFormDrillings((prev) => [
      ...prev,
      { id: crypto.randomUUID(), typeId: tempDrillType, meters: Number(tempDrillMeters) },
    ]);
    setTempDrillType('');
    setTempDrillMeters('');
    toast.success('Бурение добавлено');
  };

  const addDowntime = () => {
    if (!tempDtReason || !tempDtDuration || Number(tempDtDuration) <= 0) {
      toast.error('Заполните причину и длительность');
      return;
    }
    setFormDowntimes((prev) => [
      ...prev,
      { id: crypto.randomUUID(), reasonId: tempDtReason, duration: Number(tempDtDuration), comment: tempDtComment },
    ]);
    setTempDtReason('');
    setTempDtDuration('');
    setTempDtComment('');
    toast.success('Простой добавлен');
  };

  const handleSubmitReport = async () => {
    if (!formUserId || !formSiteId || !formDate) {
      toast.error('Заполните оператора, объект и дату');
      return;
    }
    if (formPiles.length === 0 && formDrillings.length === 0) {
      toast.error('Добавьте хотя бы одну сваю или бурение');
      return;
    }

    const reportId = editReport?.reportId || crypto.randomUUID();

    setSubmitting(true);
    try {
      const res = await authFetch('/api/reports/admin-upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId,
          userId: formUserId,
          siteId: formSiteId,
          date: formDate,
          shiftStart: formShiftStart,
          shiftEnd: formShiftEnd,
          equipmentId: formEquipmentId || undefined,
          piles: formPiles.map((p) => ({ pileGradeId: p.pileGradeId, count: p.count })),
          drillings: formDrillings.map((d) => ({ typeId: d.typeId, meters: d.meters })),
          downtimes: formDowntimes.map((d) => ({
            reasonId: d.reasonId,
            duration: d.duration,
            comment: d.comment || undefined,
          })),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Ошибка сохранения');
      }

      toast.success(editReport ? 'Отчёт обновлён' : 'Отчёт создан');
      closeDialog();
      loadReports();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Single report PDF preview ──
  const handlePreviewPdf = (report: ReportDTO) => {
    if (!report.reportId) return;
    setPreviewReportId(report.reportId);
    setPreviewReportName(`otchet-${report.date}-${report.user?.name || ''}.pdf`);
  };

  // ── Period PDF export ──

  const handleExportPdf = async () => {
    if (!periodFrom || !periodTo) return;
    setGeneratingPdf(true);
    try {
      const params = new URLSearchParams({ dateFrom: periodFrom, dateTo: periodTo });
      if (filterSiteId !== 'all') params.set('siteId', filterSiteId);
      const res = await authFetch(`/api/reports/pdf?${params}`);
      if (!res.ok) throw new Error('Ошибка генерации PDF');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pilingtrack-report-${periodFrom}-${periodTo}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('PDF скачан');
    } catch {
      toast.error('Ошибка генерации PDF');
    } finally {
      setGeneratingPdf(false);
    }
  };

  // ── Helpers ──

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const formatLastEditor = (report: ReportDTO) => {
    if (!report.lastEditedByName) {
      return report.user?.name ? `Автор: ${report.user.name}` : 'Нет данных';
    }

    const roleLabel =
      report.lastEditedByRole === 'ADMIN'
        ? 'Администратор'
        : report.lastEditedByRole === 'DISPATCHER'
          ? 'Диспетчер'
          : report.lastEditedByRole === 'ASSISTANT'
            ? 'Помощник'
            : 'Оператор';

    return `${roleLabel}: ${report.lastEditedByName}`;
  };

  const formatRecordCount = (count: number) =>
    `${count} ${pluralizeRu(count, ['запись', 'записи', 'записей'])}`;

  const formatReportCount = (count: number) =>
    `${count} ${pluralizeRu(count, ['отчёт', 'отчёта', 'отчётов'])}`;

  const getPileGradeName = (id: string) =>
    pileGrades.find((g) => g.id === id)?.name || id;
  const getDrillTypeName = (id: string) =>
    drillingTypes.find((t) => t.id === id)?.name || id;
  const getDtReasonName = (id: string) =>
    downtimeReasons.find((r) => r.id === id)?.name || id;

  const formTotalPiles = formPiles.reduce((s, p) => s + p.count, 0);
  const formTotalMeters = formDrillings.reduce((s, d) => s + d.meters, 0);
  const formTotalDowntime = formDowntimes.reduce((s, d) => s + d.duration, 0);

  if (loading) {
    return (
      <div className="space-y-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-12 w-full" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <FileText className="w-5 h-5 text-orange-500" />
          Все отчёты
        </h1>
        <span className="text-xs text-slate-500 font-mono tabular-nums">
          {formatReportCount(reports.length)}
        </span>
      </div>

      {/* ── Filters Row ── */}
      <div className="space-y-3">
        {/* Site filter */}
        {sites.length > 0 && (
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <Select value={filterSiteId} onValueChange={setFilterSiteId}>
              <SelectTrigger className="w-full max-w-xs h-10">
                <SelectValue placeholder="Все объекты" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все объекты</SelectItem>
                {sites.map((site) => (
                  <SelectItem key={site.id} value={site.id}>
                    {site.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Period filter */}
        <Card className="border-dashed">
          <CardContent className="p-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
              <CalendarDays className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <span className="text-xs font-medium text-slate-600 whitespace-nowrap">
                Период:
              </span>
              <div className="flex items-center gap-2 flex-1 w-full sm:w-auto">
                <Input
                  type="date"
                  value={periodFrom}
                  onChange={(e) => setPeriodFrom(e.target.value)}
                  className="h-9 text-sm font-mono flex-1 sm:flex-none sm:w-40"
                />
                <span className="text-slate-400 text-xs">—</span>
                <Input
                  type="date"
                  value={periodTo}
                  onChange={(e) => setPeriodTo(e.target.value)}
                  className="h-9 text-sm font-mono flex-1 sm:flex-none sm:w-40"
                />
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                {!periodActive ? (
                  <Button
                    onClick={handleApplyPeriod}
                    size="sm"
                    className="h-9 bg-slate-800 hover:bg-slate-900 text-white text-xs"
                  >
                    Применить
                  </Button>
                ) : (
                  <Button
                    onClick={handleResetPeriod}
                    variant="outline"
                    size="sm"
                    className="h-9 text-xs"
                  >
                    <RotateCcw className="w-3.5 h-3.5 mr-1" />
                    Сбросить
                  </Button>
                )}
                {periodActive && (
                  <Button
                    onClick={handleExportPdf}
                    size="sm"
                    variant="outline"
                    className="h-9 text-xs border-red-200 text-red-600 hover:bg-red-50"
                    disabled={generatingPdf}
                  >
                    {generatingPdf ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                    ) : (
                      <FileDown className="w-3.5 h-3.5 mr-1" />
                    )}
                    Печать PDF
                  </Button>
                )}
              </div>
            </div>

            {/* Period Summary */}
            {periodActive && periodSummary && (
              <div className="mt-3 flex items-center gap-4 flex-wrap">
                <span className="inline-flex items-center gap-1.5 text-xs bg-orange-50 text-orange-700 px-2.5 py-1 rounded-full font-mono">
                  <HardHat className="w-3 h-3" />
                  {periodSummary.totalPiles} св.
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full font-mono">
                  <Drill className="w-3 h-3" />
                  {formatNumber(periodSummary.totalDrilling)} м
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full font-mono">
                  <Clock className="w-3 h-3" />
                  {formatNumber(periodSummary.totalDowntime)} ч
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full font-mono">
                  {formatReportCount(periodSummary.reportCount)}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Action buttons ── */}
      <Button
        onClick={openCreateDialog}
        className="w-full sm:w-auto h-11 bg-orange-500 hover:bg-orange-600 text-white"
      >
        <Plus className="w-4 h-4 mr-2" />
        Сформировать отчёт
      </Button>

      {/* ── Reports List ── */}
      {reports.length === 0 ? (
        <div className="text-center py-16">
          <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Нет отчётов</p>
        </div>
      ) : (
        <div className="space-y-2">
          {reports.map((report, index) => {
            const totalPiles = report.piles?.reduce((s, p) => s + p.count, 0) || 0;
            const totalDrilling = report.drillings?.reduce((s, d) => s + d.meters, 0) || 0;
            const totalDowntime = report.downtimes?.reduce((s, d) => s + d.duration, 0) || 0;

            return (
              <motion.div
                key={report.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index < 20 ? index * 0.02 : 0 }}
              >
                <Card className="card-hover">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={() => setSelectedReport(report)}
                      >
                        <div className="flex items-center gap-2">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                          <p className="text-sm font-medium text-slate-900 truncate">
                            {report.user?.name || 'Неизвестный'}
                          </p>
                        </div>
                        <p className="mt-1 text-xs text-slate-500 truncate">
                          Изменил: {formatLastEditor(report)}
                        </p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                          <span className="flex items-center gap-1">
                            <CalendarDays className="w-3 h-3" />
                            {formatDate(report.date)}
                          </span>
                          <span>{report.site?.name}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant="secondary"
                          className={
                            report.status === 'submitted'
                              ? 'bg-green-100 text-green-700 border-green-200'
                              : 'bg-yellow-100 text-yellow-700 border-yellow-200'
                          }
                        >
                          {report.status === 'submitted' ? 'Отправлен' : 'Черновик'}
                        </Badge>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePreviewPdf(report);
                          }}
                          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-orange-50 text-slate-400 hover:text-orange-600 transition-colors"
                          title="Предпросмотр PDF"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditDialog(report);
                          }}
                          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-blue-50 text-slate-400 hover:text-blue-500 transition-colors"
                          title="Редактировать"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 mt-2">
                      <span className="flex items-center gap-1 text-xs">
                        <HardHat className="w-3 h-3 text-orange-500" />
                        <span className="font-mono font-semibold">{totalPiles}</span>
                        <span className="text-slate-500">св.</span>
                      </span>
                      <span className="flex items-center gap-1 text-xs">
                        <Drill className="w-3 h-3 text-blue-500" />
                        <span className="font-mono font-semibold">{totalDrilling}</span>
                        <span className="text-slate-500">м</span>
                      </span>
                      {totalDowntime > 0 && (
                        <span className="flex items-center gap-1 text-xs">
                          <Clock className="w-3 h-3 text-amber-500" />
                          <span className="font-mono font-semibold text-amber-600">{totalDowntime}</span>
                          <span className="text-slate-500">ч</span>
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* ── Detail Dialog ── */}
      <Dialog
        open={!!selectedReport}
        onOpenChange={(open) => {
          if (!open) setSelectedReport(null);
        }}
      >
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto custom-scrollbar">
          {selectedReport && (
            <>
              <div className="flex items-center justify-between">
                <DialogHeader>
                  <DialogTitle className="text-base">
                    Отчёт от {formatDate(selectedReport.date)}
                  </DialogTitle>
                </DialogHeader>
                <button
                  onClick={() => handlePreviewPdf(selectedReport)}
                  className="flex items-center gap-1.5 text-xs font-medium text-orange-600 hover:text-orange-700 bg-orange-50 hover:bg-orange-100 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <Eye className="w-3.5 h-3.5" />
                  Предпросмотр PDF
                </button>
              </div>
              <div className="space-y-4 mt-2">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-slate-500">Оператор</p>
                    <p className="font-medium">{selectedReport.user?.name || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Объект</p>
                    <p className="font-medium">{selectedReport.site?.name || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Смена</p>
                    <p className="font-mono">
                      {selectedReport.shiftStart || '—'} – {selectedReport.shiftEnd || '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Статус</p>
                    <Badge
                      variant="secondary"
                      className={
                        selectedReport.status === 'submitted'
                          ? 'bg-green-100 text-green-700 border-green-200'
                          : 'bg-yellow-100 text-yellow-700 border-yellow-200'
                      }
                    >
                      {selectedReport.status === 'submitted' ? 'Отправлен' : 'Черновик'}
                    </Badge>
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs text-slate-500">Последнее редактирование</p>
                    <p className="font-medium">{formatLastEditor(selectedReport)}</p>
                  </div>
                </div>

                {selectedReport.piles?.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                        <HardHat className="w-4 h-4 text-orange-500" />
                        Забитые сваи ({formatRecordCount(selectedReport.piles.length)})
                      </h4>
                      <div className="space-y-1">
                        {selectedReport.piles.map((p) => (
                          <div
                            key={p.id}
                            className="flex justify-between text-sm p-2 bg-slate-50 rounded"
                          >
                            <span>{p.pileGrade?.name || '—'}</span>
                            <span className="font-mono font-semibold">{p.count} шт.</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {selectedReport.drillings?.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                        <Drill className="w-4 h-4 text-blue-500" />
                        Лидерное бурение ({formatRecordCount(selectedReport.drillings.length)})
                      </h4>
                      <div className="space-y-1">
                        {selectedReport.drillings.map((d) => (
                          <div
                            key={d.id}
                            className="flex justify-between text-sm p-2 bg-slate-50 rounded"
                          >
                            <span>{d.type?.name || '—'}</span>
                            <span className="font-mono font-semibold">{d.meters} м</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {selectedReport.downtimes?.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                        <Clock className="w-4 h-4 text-amber-500" />
                        Простой техники
                      </h4>
                      <div className="space-y-1">
                        {selectedReport.downtimes.map((dt) => (
                          <div
                            key={dt.id}
                            className="flex justify-between text-sm p-2 bg-slate-50 rounded"
                          >
                            <div>
                              <span>{dt.reason?.name || '—'}</span>
                              {dt.comment && (
                                <p className="text-[10px] text-slate-500">{dt.comment}</p>
                              )}
                            </div>
                            <span className="font-mono font-semibold text-amber-600">{dt.duration} ч</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* PDF Preview Dialog */}
      <PdfPreviewDialog
        open={!!previewReportId}
        onOpenChange={(open) => { if (!open) setPreviewReportId(null); }}
        reportId={previewReportId}
        downloadName={previewReportName}
      />

      {/* ── Create/Edit Report Dialog ── */}
      <Dialog
        open={showCreateDialog}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto custom-scrollbar">
          <DialogHeader>
            <DialogTitle className="text-base">
              {editReport ? 'Редактировать отчёт' : 'Сформировать отчёт'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            {/* Operator & Site & Date */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600">Оператор</Label>
                <Select value={formUserId} onValueChange={setFormUserId}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Выберите оператора" />
                  </SelectTrigger>
                  <SelectContent>
                    {operators.map((op) => (
                      <SelectItem key={op.id} value={op.id}>
                        {op.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600">Объект</Label>
                <Select value={formSiteId} onValueChange={setFormSiteId}>
                  <SelectTrigger className="h-10">
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

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600">Дата</Label>
                <Input
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="h-10 font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-slate-600">Начало</Label>
                  <Input
                    type="time"
                    value={formShiftStart}
                    onChange={(e) => setFormShiftStart(e.target.value)}
                    className="h-10 font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-slate-600">Конец</Label>
                  <Input
                    type="time"
                    value={formShiftEnd}
                    onChange={(e) => setFormShiftEnd(e.target.value)}
                    className="h-10 font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                  <Wrench className="w-3.5 h-3.5" />
                  Установка
                </Label>
                <Select value={formEquipmentId} onValueChange={setFormEquipmentId}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Выберите установку..." />
                  </SelectTrigger>
                  <SelectContent>
                    {equipment.map((eq) => (
                      <SelectItem key={eq.id} value={eq.id}>{eq.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            {/* Piles */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <HardHat className="w-4 h-4 text-orange-500" />
                  Забитые сваи
                </h4>
                {formTotalPiles > 0 && (
                  <span className="text-xs font-mono font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">
                    {formTotalPiles} шт.
                  </span>
                )}
              </div>

              <div className="flex gap-2 mb-2">
                <Select value={tempPileGrade} onValueChange={setTempPileGrade}>
                  <SelectTrigger className="flex-1 h-9 text-sm">
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
                <Input
                  type="number"
                  placeholder="Кол-во"
                  value={tempPileCount}
                  onChange={(e) => setTempPileCount(e.target.value)}
                  min="1"
                  className="w-20 h-9 font-mono text-sm"
                />
                <Button
                  onClick={addPile}
                  size="sm"
                  className="h-9 bg-orange-500 hover:bg-orange-600 text-white px-3"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>

              {formPiles.length > 0 && (
                <div className="space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
                  {formPiles.map((pile) => (
                    <div
                      key={pile.id}
                      className="flex items-center justify-between p-2 bg-slate-50 rounded text-sm"
                    >
                      <span className="font-medium">{getPileGradeName(pile.pileGradeId)}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold">{pile.count} шт.</span>
                        <button
                          onClick={() => setFormPiles((prev) => prev.filter((p) => p.id !== pile.id))}
                          className="w-6 h-6 rounded flex items-center justify-center hover:bg-red-100 text-slate-400 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            {/* Drillings */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <Drill className="w-4 h-4 text-blue-500" />
                  Лидерное бурение
                </h4>
                {formTotalMeters > 0 && (
                  <span className="text-xs font-mono font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                    {formTotalMeters.toFixed(1)} м
                  </span>
                )}
              </div>

              <div className="flex gap-2 mb-2">
                <Select value={tempDrillType} onValueChange={setTempDrillType}>
                  <SelectTrigger className="flex-1 h-9 text-sm">
                    <SelectValue placeholder="Тип скважины..." />
                  </SelectTrigger>
                  <SelectContent>
                    {drillingTypes.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  step="0.1"
                  placeholder="Метры"
                  value={tempDrillMeters}
                  onChange={(e) => setTempDrillMeters(e.target.value)}
                  min="0.1"
                  className="w-24 h-9 font-mono text-sm"
                />
                <Button
                  onClick={addDrilling}
                  size="sm"
                  className="h-9 bg-blue-500 hover:bg-blue-600 text-white px-3"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>

              {formDrillings.length > 0 && (
                <div className="space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
                  {formDrillings.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between p-2 bg-slate-50 rounded text-sm"
                    >
                      <span className="font-medium">{getDrillTypeName(d.typeId)}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold">{d.meters} м</span>
                        <button
                          onClick={() => setFormDrillings((prev) => prev.filter((dr) => dr.id !== d.id))}
                          className="w-6 h-6 rounded flex items-center justify-center hover:bg-red-100 text-slate-400 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            {/* Downtime */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-500" />
                  Простой техники
                </h4>
                <button
                  onClick={() => setShowFormDowntime(!showFormDowntime)}
                  className="text-xs text-orange-500 font-medium"
                >
                  {showFormDowntime ? 'Скрыть' : '+ Добавить'}
                </button>
              </div>

              {showFormDowntime && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Select value={tempDtReason} onValueChange={setTempDtReason}>
                      <SelectTrigger className="flex-1 h-9 text-sm">
                        <SelectValue placeholder="Причина..." />
                      </SelectTrigger>
                      <SelectContent>
                        {downtimeReasons.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      step="0.5"
                      placeholder="Часы"
                      value={tempDtDuration}
                      onChange={(e) => setTempDtDuration(e.target.value)}
                      min="0.5"
                      className="w-20 h-9 font-mono text-sm"
                    />
                    <Button
                      onClick={addDowntime}
                      size="sm"
                      className="h-9 bg-amber-500 hover:bg-amber-600 text-white px-3"
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                  <Input
                    placeholder="Комментарий (необязательно)"
                    value={tempDtComment}
                    onChange={(e) => setTempDtComment(e.target.value)}
                    className="h-9 text-sm"
                  />

                  {formDowntimes.length > 0 && (
                    <div className="space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
                      {formDowntimes.map((dt) => (
                        <div
                          key={dt.id}
                          className="flex items-center justify-between p-2 bg-slate-50 rounded text-sm"
                        >
                          <div className="min-w-0">
                            <span className="font-medium">{getDtReasonName(dt.reasonId)}</span>
                            {dt.comment && (
                              <p className="text-[10px] text-slate-500 truncate">{dt.comment}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-semibold text-amber-600">{dt.duration} ч</span>
                            <button
                              onClick={() => setFormDowntimes((prev) => prev.filter((d) => d.id !== dt.id))}
                              className="w-6 h-6 rounded flex items-center justify-center hover:bg-red-100 text-slate-400 hover:text-red-500 transition-colors"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Summary */}
            {(formPiles.length > 0 || formDrillings.length > 0 || formDowntimes.length > 0) && (
              <div className="bg-slate-900 rounded-lg p-3 text-white">
                <p className="text-[10px] font-medium text-slate-400 mb-2">Итого</p>
                <div className="flex items-center gap-4 text-sm">
                  <span className="font-mono font-bold">{formTotalPiles} св.</span>
                  <span className="font-mono font-bold">{formTotalMeters.toFixed(1)} м</span>
                  {formDowntimes.length > 0 && (
                    <span className="font-mono font-bold text-amber-400">{formTotalDowntime} ч</span>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="pt-2">
            <Button
              variant="outline"
              onClick={closeDialog}
              className="h-10"
            >
              Отмена
            </Button>
            <Button
              onClick={handleSubmitReport}
              disabled={submitting}
              className="h-10 bg-orange-500 hover:bg-orange-600 text-white"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Сохранение...
                </>
              ) : (
                <>
                  {editReport ? <Pencil className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                  {editReport ? 'Сохранить' : 'Создать'}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
